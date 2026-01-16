// ============================================================================
// SALESFORCE IMPORT HOOKS
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { User } from './types';
import {
  ImportBatch,
  ImportStagingRow,
  ImportMatchStatus,
  OpportunityStage,
  parseSalesforceStage,
  extractSfidFromLink,
  parseGermanDate,
} from './pipeline-types';

// ============================================================================
// useImportBatches - Alle Batches laden
// ============================================================================
export function useImportBatches() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('import_batches')
      .select(`
        *,
        created_by_user:users!import_batches_created_by_fkey(name),
        rolled_back_by_user:users!import_batches_rolled_back_by_fkey(name)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setBatches(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  return { batches, loading, error, refetch: fetchBatches };
}

// ============================================================================
// useOpenBatch - Prüfen ob ein offener Batch existiert
// ============================================================================
export function useOpenBatch() {
  const [openBatch, setOpenBatch] = useState<ImportBatch | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOpenBatch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('import_batches')
      .select('*')
      .eq('status', 'open')
      .single();

    setOpenBatch(data || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOpenBatch();
  }, [fetchOpenBatch]);

  return { openBatch, loading, refetch: fetchOpenBatch };
}

// ============================================================================
// useImportStaging - Staging-Daten für einen Batch laden
// ============================================================================
export function useImportStaging(batchId: string | null) {
  const [rows, setRows] = useState<ImportStagingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    new: 0,
    changed: 0,
    unchanged: 0,
    conflict: 0,
    selected: 0,
  });

  const fetchRows = useCallback(async () => {
    if (!batchId) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('import_staging')
      .select(`
        *,
        matched_user:users!import_staging_matched_user_id_fkey(id, name)
      `)
      .eq('batch_id', batchId)
      .order('row_number', { ascending: true });

    if (!error && data) {
      setRows(data);
      
      // Stats berechnen
      setStats({
        total: data.length,
        new: data.filter(r => r.match_status === 'new').length,
        changed: data.filter(r => r.match_status === 'changed').length,
        unchanged: data.filter(r => r.match_status === 'unchanged').length,
        conflict: data.filter(r => r.match_status === 'conflict').length,
        selected: data.filter(r => r.is_selected).length,
      });
    }
    setLoading(false);
  }, [batchId]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Row Selection Toggle
  const toggleSelection = async (rowId: string, selected: boolean) => {
    await supabase
      .from('import_staging')
      .update({ is_selected: selected })
      .eq('id', rowId);
    fetchRows();
  };

  // Select All
  const selectAll = async (selected: boolean, matchStatus?: ImportMatchStatus) => {
    let query = supabase
      .from('import_staging')
      .update({ is_selected: selected })
      .eq('batch_id', batchId);
    
    if (matchStatus) {
      query = query.eq('match_status', matchStatus);
    }
    
    await query;
    fetchRows();
  };

  // User manuell zuweisen (einzeln)
  const assignUser = async (rowId: string, userId: string) => {
    await supabase
      .from('import_staging')
      .update({ 
        matched_user_id: userId,
        user_match_status: 'manual',
        conflict_resolved: true,
        match_status: 'new', // Konflikt wird zu "Neu" wenn User zugewiesen
      })
      .eq('id', rowId);
    fetchRows();
  };

  // Bulk-Assign: Alle Konflikte mit bestimmtem Owner-Namen einem User zuweisen
  const bulkAssignByOwnerName = async (ownerName: string, userId: string) => {
    await supabase
      .from('import_staging')
      .update({ 
        matched_user_id: userId,
        user_match_status: 'manual',
        conflict_resolved: true,
        match_status: 'new', // Konflikt wird zu "Neu"
      })
      .eq('batch_id', batchId)
      .eq('match_status', 'conflict')
      .eq('parsed_owner_name', ownerName);
    fetchRows();
  };

  // Bulk-Assign: ALLE Konflikte einem User zuweisen
  const bulkAssignAllConflicts = async (userId: string) => {
    await supabase
      .from('import_staging')
      .update({ 
        matched_user_id: userId,
        user_match_status: 'manual',
        conflict_resolved: true,
        match_status: 'new',
      })
      .eq('batch_id', batchId)
      .eq('match_status', 'conflict');
    fetchRows();
  };

  // Einzigartige Owner-Namen der Konflikte ermitteln
  const conflictOwners = [...new Set(
    rows
      .filter(r => r.match_status === 'conflict')
      .map(r => r.parsed_owner_name)
      .filter(Boolean)
  )] as string[];

  return { 
    rows, 
    loading, 
    stats, 
    refetch: fetchRows,
    toggleSelection,
    selectAll,
    assignUser,
    bulkAssignByOwnerName,
    bulkAssignAllConflicts,
    conflictOwners,
  };
}

// ============================================================================
// Salesforce CSV Parser
// ============================================================================
interface ParsedSalesforceRow {
  company_name: string;
  opportunity_name: string;
  stage: OpportunityStage;
  close_date: string | null;
  created_date: string | null;
  owner_name: string;
  notes: string | null;
  rating: string | null;
  sfid: string | null;
  raw: Record<string, string>;
}

export function parseSalesforceCSV(csvText: string): ParsedSalesforceRow[] {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  // Header parsen (Semikolon-getrennt)
  const headers = lines[0].split(';').map(h => 
    h.trim().toLowerCase().replace(/['"]/g, '').replace(/[äöü]/g, c => 
      c === 'ä' ? 'ae' : c === 'ö' ? 'oe' : 'ue'
    )
  );

  // Column-Index finden
  const findCol = (names: string[]) => {
    for (const name of names) {
      const idx = headers.findIndex(h => h.includes(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const colOppName = findCol(['opportunity-name', 'opportunity name', 'opp name']);
  const colPhase = findCol(['phase', 'stage']);
  const colCloseDate = findCol(['schlusstermin', 'close date', 'closedate']);
  const colCreatedDate = findCol(['erstelldatum', 'created date', 'createddate']);
  const colOwner = findCol(['opportunity-inhaber', 'owner', 'inhaber']);
  const colRating = findCol(['rating']);
  const colNextStep = findCol(['naechster schritt', 'next step']);
  const colSignUpLink = findCol(['unique sign up link', 'signup link', 'sign up']);

  const results: ParsedSalesforceRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';').map(v => v.trim().replace(/^["']|["']$/g, ''));
    
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      raw[h] = values[idx] || '';
    });

    const oppName = colOppName >= 0 ? values[colOppName] || '' : '';
    const phase = colPhase >= 0 ? values[colPhase] || '' : '';
    const signUpLink = colSignUpLink >= 0 ? values[colSignUpLink] || '' : '';
    const nextStep = colNextStep >= 0 ? values[colNextStep] || '' : '';
    const rating = colRating >= 0 ? values[colRating] || '' : '';

    // Skip leere Zeilen
    if (!oppName) continue;

    // Company Name = Opportunity Name ohne trailing "-"
    const companyName = oppName.replace(/-$/, '').trim();

    results.push({
      company_name: companyName,
      opportunity_name: oppName,
      stage: parseSalesforceStage(phase),
      close_date: colCloseDate >= 0 ? parseGermanDate(values[colCloseDate]) : null,
      created_date: colCreatedDate >= 0 ? parseGermanDate(values[colCreatedDate]) : null,
      owner_name: colOwner >= 0 ? values[colOwner] || '' : '',
      notes: nextStep || null,
      rating: rating || null,
      sfid: extractSfidFromLink(signUpLink),
      raw,
    });
  }

  return results;
}

// ============================================================================
// createImportBatch - Neuen Batch erstellen und CSV verarbeiten
// ============================================================================
export async function createImportBatch(
  csvText: string,
  filename: string,
  userId: string,
  allUsers: User[]
): Promise<{ batch: ImportBatch | null; error: string | null }> {
  
  // 1. Prüfen ob offener Batch existiert
  const { data: existingOpen } = await supabase
    .from('import_batches')
    .select('id')
    .eq('status', 'open')
    .single();

  if (existingOpen) {
    return { 
      batch: null, 
      error: 'Es existiert bereits ein offener Import-Stapel. Bitte erst verarbeiten oder verwerfen.' 
    };
  }

  // 2. CSV parsen
  const parsedRows = parseSalesforceCSV(csvText);
  if (parsedRows.length === 0) {
    return { batch: null, error: 'CSV enthält keine gültigen Daten.' };
  }

  // 3. Batch erstellen
  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      created_by: userId,
      source_filename: filename,
      source_type: 'salesforce',
      status: 'open',
      stats_total: parsedRows.length,
    })
    .select()
    .single();

  if (batchError || !batch) {
    return { batch: null, error: batchError?.message || 'Fehler beim Erstellen des Batches' };
  }

  // 4. Existierende Leads/Opportunities laden für Matching
  const { data: existingLeads } = await supabase
    .from('leads')
    .select('id, company_name, sfid');

  // WICHTIG: Alle Opportunities laden (inkl. archivierte) für Duplikat-Check!
  // So werden auch archivierte Datensätze beim Import erkannt und nicht erneut importiert
  const { data: existingOpps } = await supabase
    .from('opportunities')
    .select('id, name, stage, sfid, lead_id, archived');

  // Maps für schnelles Lookup
  const leadsBySfid = new Map(existingLeads?.filter(l => l.sfid).map(l => [l.sfid, l]) || []);
  const leadsByName = new Map(existingLeads?.map(l => [l.company_name.toLowerCase(), l]) || []);
  const oppsBySfid = new Map(existingOpps?.filter(o => o.sfid).map(o => [o.sfid, o]) || []);
  const oppsByName = new Map(existingOpps?.map(o => [o.name.toLowerCase(), o]) || []);

  // User-Matching Map - mit Normalisierung
  const normalizeUserName = (name: string) => 
    name.toLowerCase().trim().replace(/\s+/g, ' ');
  
  const usersByName = new Map(
    allUsers.map(u => [normalizeUserName(u.name), u])
  );

  // 5. Staging-Rows erstellen
  const stagingRows = parsedRows.map((row, index) => {
    // User-Matching mit normalisiertem Namen
    const normalizedOwner = normalizeUserName(row.owner_name);
    const matchedUser = usersByName.get(normalizedOwner);
    const userMatchStatus = matchedUser ? 'matched' : 'unmatched';

    // Lead/Opportunity Matching
    let matchedLead = row.sfid ? leadsBySfid.get(row.sfid) : null;
    if (!matchedLead) {
      matchedLead = leadsByName.get(row.company_name.toLowerCase());
    }

    let matchedOpp = row.sfid ? oppsBySfid.get(row.sfid) : null;
    if (!matchedOpp) {
      matchedOpp = oppsByName.get(row.opportunity_name.toLowerCase());
    }

    // Match-Status bestimmen
    let matchStatus: ImportMatchStatus = 'new';
    let changes: Record<string, { from: string; to: string }> | null = null;

    if (matchedOpp) {
      // Prüfen ob sich etwas geändert hat
      if (matchedOpp.stage !== row.stage) {
        matchStatus = 'changed';
        changes = {
          stage: { from: matchedOpp.stage, to: row.stage }
        };
      } else {
        matchStatus = 'unchanged';
      }
    }

    // Conflict nur bei AKTIVEN Stages wenn User nicht gefunden
    // Bei close_won/close_lost: Kein Konflikt - wird mit sf_owner_name importiert
    const isClosedStage = row.stage === 'close_won' || row.stage === 'close_lost';
    if (userMatchStatus === 'unmatched' && matchStatus !== 'unchanged' && !isClosedStage) {
      matchStatus = 'conflict';
    }

    return {
      batch_id: batch.id,
      row_number: index + 1,
      raw_data: row.raw,
      parsed_company_name: row.company_name,
      parsed_opportunity_name: row.opportunity_name,
      parsed_stage: row.stage,
      parsed_close_date: row.close_date,
      parsed_created_date: row.created_date,
      parsed_owner_name: row.owner_name,
      parsed_notes: row.notes,
      parsed_rating: row.rating,
      sfid: row.sfid,
      match_status: matchStatus,
      matched_lead_id: matchedLead?.id || null,
      matched_opportunity_id: matchedOpp?.id || null,
      matched_user_id: matchedUser?.id || null,
      user_match_status: userMatchStatus,
      changes,
      is_selected: matchStatus !== 'unchanged', // Unveränderte nicht vorausgewählt
    };
  });

  // 6. Staging-Rows einfügen
  const { error: stagingError } = await supabase
    .from('import_staging')
    .insert(stagingRows);

  if (stagingError) {
    // Batch löschen wenn Staging fehlschlägt
    await supabase.from('import_batches').delete().eq('id', batch.id);
    return { batch: null, error: stagingError.message };
  }

  // 7. Stats aktualisieren
  const stats = {
    stats_new: stagingRows.filter(r => r.match_status === 'new').length,
    stats_updated: stagingRows.filter(r => r.match_status === 'changed').length,
    stats_skipped: stagingRows.filter(r => r.match_status === 'unchanged').length,
    stats_conflicts: stagingRows.filter(r => r.match_status === 'conflict').length,
  };

  await supabase
    .from('import_batches')
    .update(stats)
    .eq('id', batch.id);

  return { batch: { ...batch, ...stats }, error: null };
}

// ============================================================================
// commitImportBatch - Batch übernehmen (mit Progress-Callback)
// ============================================================================
export async function commitImportBatch(
  batchId: string,
  userId: string,
  onProgress?: (current: number, total: number) => void
): Promise<{ success: boolean; error: string | null; stats: { leads: number; opportunities: number; unassigned?: number } }> {
  
  // 1. Ausgewählte Rows laden
  const { data: selectedRows, error: fetchError } = await supabase
    .from('import_staging')
    .select('*')
    .eq('batch_id', batchId)
    .eq('is_selected', true)
    .in('match_status', ['new', 'changed']);

  if (fetchError || !selectedRows) {
    return { success: false, error: fetchError?.message || 'Fehler beim Laden', stats: { leads: 0, opportunities: 0 } };
  }

  const total = selectedRows.length;
  if (onProgress) onProgress(0, total);

  // Separate neue und geänderte Datensätze
  const newRows = selectedRows.filter(r => r.match_status === 'new');
  const changedRows = selectedRows.filter(r => r.match_status === 'changed');

  let leadsCreated = 0;
  let oppsCreated = 0;
  let oppsUpdated = 0;

  // ========================================
  // BATCH INSERT: Neue Leads (in Chunks von 100)
  // ========================================
  const BATCH_SIZE = 100;
  let allInsertedLeads: any[] = [];
  
  if (newRows.length > 0) {
    const leadsToInsert = newRows.map(row => ({
      user_id: row.matched_user_id,
      company_name: row.parsed_company_name,
      lead_source: 'inbound',
      notes: row.parsed_notes,
      import_batch_id: batchId,
      sfid: row.sfid,
    }));

    // In Chunks von 100 einfügen
    for (let i = 0; i < leadsToInsert.length; i += BATCH_SIZE) {
      const chunk = leadsToInsert.slice(i, i + BATCH_SIZE);
      const { data: insertedChunk, error: leadsError } = await supabase
        .from('leads')
        .insert(chunk)
        .select();

      if (leadsError) {
        return { success: false, error: `Fehler beim Erstellen der Leads: ${leadsError.message}`, stats: { leads: allInsertedLeads.length, opportunities: 0 } };
      }
      
      if (insertedChunk) {
        allInsertedLeads = [...allInsertedLeads, ...insertedChunk];
      }
      
      // Progress Update
      const progressPercent = Math.round((i + chunk.length) / leadsToInsert.length * 30);
      if (onProgress) onProgress(Math.round(total * progressPercent / 100), total);
    }

    leadsCreated = allInsertedLeads.length;
    if (onProgress) onProgress(Math.round(total * 0.3), total); // 30% nach Leads

    // ========================================
    // BATCH INSERT: Neue Opportunities (in Chunks von 100)
    // ========================================
    if (allInsertedLeads.length > 0) {
      // Map SFID zu Lead ID
      const leadBySfid = new Map(allInsertedLeads.map(l => [l.sfid, l]));
      const leadByCompany = new Map(allInsertedLeads.map(l => [l.company_name?.toLowerCase(), l]));

      const oppsToInsert = newRows.map(row => {
        // Finde den passenden Lead
        const lead = row.sfid ? leadBySfid.get(row.sfid) : leadByCompany.get(row.parsed_company_name?.toLowerCase());
        return {
          lead_id: lead?.id,
          user_id: row.matched_user_id,
          name: row.parsed_opportunity_name,
          stage: row.parsed_stage,
          expected_close_date: row.parsed_close_date,
          import_batch_id: batchId,
          sfid: row.sfid,
          sf_owner_name: row.parsed_owner_name || null,
          sf_created_date: row.created_date || null,
        };
      }).filter(o => o.lead_id); // Nur wenn Lead gefunden

      let allInsertedOpps: any[] = [];
      
      // In Chunks von 100 einfügen
      for (let i = 0; i < oppsToInsert.length; i += BATCH_SIZE) {
        const chunk = oppsToInsert.slice(i, i + BATCH_SIZE);
        const { data: insertedChunk, error: oppsError } = await supabase
          .from('opportunities')
          .insert(chunk)
          .select();

        if (oppsError) {
          return { success: false, error: `Fehler beim Erstellen der Opportunities: ${oppsError.message}`, stats: { leads: leadsCreated, opportunities: allInsertedOpps.length } };
        }
        
        if (insertedChunk) {
          allInsertedOpps = [...allInsertedOpps, ...insertedChunk];
        }
        
        // Progress Update
        const progressPercent = 30 + Math.round((i + chunk.length) / oppsToInsert.length * 30);
        if (onProgress) onProgress(Math.round(total * progressPercent / 100), total);
      }

      oppsCreated = allInsertedOpps.length;
      if (onProgress) onProgress(Math.round(total * 0.6), total); // 60% nach Opportunities

      // ========================================
      // BATCH UPDATE: Staging-Rows aktualisieren
      // ========================================
      const oppBySfid = new Map(allInsertedOpps?.map(o => [o.sfid, o]) || []);
      
      // Update staging in Batches von 50
      const stagingUpdates = newRows.map(row => {
        const lead = row.sfid ? leadBySfid.get(row.sfid) : leadByCompany.get(row.parsed_company_name?.toLowerCase());
        const opp = row.sfid ? oppBySfid.get(row.sfid) : null;
        return {
          id: row.id,
          created_lead_id: lead?.id || null,
          created_opportunity_id: opp?.id || null,
        };
      });

      // Supabase upsert für Staging-Updates
      for (let i = 0; i < stagingUpdates.length; i += 50) {
        const batch = stagingUpdates.slice(i, i + 50);
        await Promise.all(batch.map(update => 
          supabase
            .from('import_staging')
            .update({ 
              created_lead_id: update.created_lead_id, 
              created_opportunity_id: update.created_opportunity_id 
            })
            .eq('id', update.id)
        ));
      }
    }
  }

  if (onProgress) onProgress(Math.round(total * 0.8), total); // 80%

  // ========================================
  // BATCH UPDATE: Geänderte Opportunities
  // ========================================
  if (changedRows.length > 0) {
    // Updates parallel in Batches von 20
    for (let i = 0; i < changedRows.length; i += 20) {
      const batch = changedRows.slice(i, i + 20);
      await Promise.all(batch.map(row => {
        const updateData: Record<string, any> = {
          stage: row.parsed_stage,
          expected_close_date: row.parsed_close_date,
          stage_changed_at: new Date().toISOString(),
          sf_owner_name: row.parsed_owner_name || null,
          sf_created_date: row.created_date || null,
        };
        if (row.matched_user_id) {
          updateData.user_id = row.matched_user_id;
        }
        return supabase
          .from('opportunities')
          .update(updateData)
          .eq('id', row.matched_opportunity_id);
      }));
      oppsUpdated += batch.length;
    }
  }

  if (onProgress) onProgress(total, total); // 100%

  // ========================================
  // Batch als completed markieren
  // ========================================
  await supabase
    .from('import_batches')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      stats_new: leadsCreated,
      stats_updated: oppsUpdated,
    })
    .eq('id', batchId);

  const unassignedCount = selectedRows.filter(r => !r.matched_user_id).length;

  return { 
    success: true, 
    error: null, 
    stats: { 
      leads: leadsCreated, 
      opportunities: oppsCreated + oppsUpdated,
      unassigned: unassignedCount
    } 
  };
}

// ============================================================================
// discardImportBatch - Batch verwerfen
// ============================================================================
export async function discardImportBatch(batchId: string): Promise<{ success: boolean; error: string | null }> {
  const { error } = await supabase
    .from('import_batches')
    .update({
      status: 'discarded',
      discarded_at: new Date().toISOString(),
    })
    .eq('id', batchId);

  return { success: !error, error: error?.message || null };
}

// ============================================================================
// rollbackImportBatch - Batch zurückrollen
// ============================================================================
export async function rollbackImportBatch(
  batchId: string,
  userId: string
): Promise<{ success: boolean; error: string | null; stats: { leads: number; opportunities: number; golives: number } }> {
  
  // 1. Batch prüfen
  const { data: batch } = await supabase
    .from('import_batches')
    .select('*')
    .eq('id', batchId)
    .single();

  if (!batch) {
    return { success: false, error: 'Batch nicht gefunden', stats: { leads: 0, opportunities: 0, golives: 0 } };
  }

  if (batch.status !== 'completed') {
    return { success: false, error: 'Nur abgeschlossene Batches können zurückgerollt werden', stats: { leads: 0, opportunities: 0, golives: 0 } };
  }

  // 2. Go-Lives entkoppeln
  const { data: affectedOpps } = await supabase
    .from('opportunities')
    .select('id')
    .eq('import_batch_id', batchId);

  const oppIds = affectedOpps?.map(o => o.id) || [];

  const { data: affectedLeads } = await supabase
    .from('leads')
    .select('id')
    .eq('import_batch_id', batchId);

  const leadIds = affectedLeads?.map(l => l.id) || [];

  let golivesUpdated = 0;
  if (oppIds.length > 0 || leadIds.length > 0) {
    const { count } = await supabase
      .from('go_lives')
      .update({ opportunity_id: null, lead_id: null })
      .or(`opportunity_id.in.(${oppIds.join(',')}),lead_id.in.(${leadIds.join(',')})`)
      .select('id', { count: 'exact' });
    
    golivesUpdated = count || 0;
  }

  // 3. Opportunities löschen
  const { count: oppsDeleted } = await supabase
    .from('opportunities')
    .delete()
    .eq('import_batch_id', batchId)
    .select('id', { count: 'exact' });

  // 4. Leads löschen
  const { count: leadsDeleted } = await supabase
    .from('leads')
    .delete()
    .eq('import_batch_id', batchId)
    .select('id', { count: 'exact' });

  // 5. Batch-Status aktualisieren
  await supabase
    .from('import_batches')
    .update({
      status: 'rolled_back',
      rolled_back_at: new Date().toISOString(),
      rolled_back_by: userId,
    })
    .eq('id', batchId);

  return { 
    success: true, 
    error: null, 
    stats: { 
      leads: leadsDeleted || 0, 
      opportunities: oppsDeleted || 0, 
      golives: golivesUpdated 
    } 
  };
}
