#!/usr/bin/env node

/**
 * ============================================================================
 * AE Kompensation - Standalone Backup Restore Script
 * ============================================================================
 * 
 * Dieses Script stellt ein Backup direkt in die Supabase-Datenbank wieder her.
 * Es funktioniert unabhängig von der App - auch wenn die App nicht mehr startet.
 * 
 * VERWENDUNG:
 *   node restore-backup.js <backup-datei.json>
 * 
 * BEISPIEL:
 *   node restore-backup.js backup_ae-comp_2026-01-12-14-30-00.json
 * 
 * VORAUSSETZUNGEN:
 *   - Node.js installiert (v16+)
 *   - npm install @supabase/supabase-js (einmalig)
 *   - Supabase URL und Service Role Key (siehe .env.example)
 * 
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// KONFIGURATION - HIER DEINE SUPABASE-DATEN EINTRAGEN!
// ============================================================================

// Option 1: Direkt hier eintragen (einfacher)
const SUPABASE_URL = process.env.SUPABASE_URL || 'HIER_DEINE_SUPABASE_URL';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'HIER_DEIN_SERVICE_ROLE_KEY';

// Option 2: Aus .env Datei laden (sicherer)
// Erstelle eine .env Datei im gleichen Ordner mit:
//   SUPABASE_URL=https://xxxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// ============================================================================
// AB HIER NICHTS ÄNDERN
// ============================================================================

async function loadSupabase() {
  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  } catch (err) {
    console.error('\n❌ Supabase-Client konnte nicht geladen werden.');
    console.error('   Führe zuerst aus: npm install @supabase/supabase-js\n');
    process.exit(1);
  }
}

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    });
    console.log('✅ .env Datei geladen');
  }
}

function printHeader() {
  console.log('\n' + '='.repeat(60));
  console.log('  AE Kompensation - Backup Restore Script');
  console.log('='.repeat(60) + '\n');
}

function printUsage() {
  console.log('VERWENDUNG:');
  console.log('  node restore-backup.js <backup-datei.json>\n');
  console.log('BEISPIEL:');
  console.log('  node restore-backup.js backup_ae-comp_2026-01-12-14-30-00.json\n');
  console.log('OPTIONEN:');
  console.log('  --dry-run    Nur prüfen, keine Änderungen vornehmen');
  console.log('  --help       Diese Hilfe anzeigen\n');
}

async function main() {
  printHeader();
  
  // .env laden falls vorhanden
  loadEnvFile();
  
  // Argumente prüfen
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(0);
  }
  
  const dryRun = args.includes('--dry-run');
  const backupFile = args.find(arg => !arg.startsWith('--'));
  
  if (!backupFile) {
    console.error('❌ Keine Backup-Datei angegeben!\n');
    printUsage();
    process.exit(1);
  }
  
  // Konfiguration prüfen
  if (SUPABASE_URL.includes('HIER_DEINE') || SUPABASE_SERVICE_KEY.includes('HIER_DEIN')) {
    console.error('❌ Supabase-Konfiguration fehlt!\n');
    console.error('   Bitte trage deine Supabase-Daten ein:');
    console.error('   1. Öffne restore-backup.js in einem Texteditor');
    console.error('   2. Ersetze HIER_DEINE_SUPABASE_URL mit deiner URL');
    console.error('   3. Ersetze HIER_DEIN_SERVICE_ROLE_KEY mit deinem Key\n');
    console.error('   Du findest diese Daten in Supabase unter:');
    console.error('   Project Settings → API → Project URL & service_role key\n');
    process.exit(1);
  }
  
  // Backup-Datei laden
  console.log(`📁 Lade Backup: ${backupFile}`);
  
  if (!fs.existsSync(backupFile)) {
    console.error(`\n❌ Datei nicht gefunden: ${backupFile}\n`);
    process.exit(1);
  }
  
  let backup;
  try {
    const content = fs.readFileSync(backupFile, 'utf-8');
    backup = JSON.parse(content);
  } catch (err) {
    console.error('\n❌ Datei konnte nicht gelesen werden. Ist es gültiges JSON?\n');
    process.exit(1);
  }
  
  // Backup validieren
  if (!backup.version || !backup.tables) {
    console.error('\n❌ Ungültiges Backup-Format!\n');
    process.exit(1);
  }
  
  // Backup-Info anzeigen
  console.log('\n📋 Backup-Informationen:');
  console.log('─'.repeat(40));
  console.log(`   Erstellt am:    ${new Date(backup.created_at).toLocaleString('de-DE')}`);
  console.log(`   App-Version:    ${backup.app_version}`);
  console.log(`   Backup-Version: ${backup.version}`);
  console.log('');
  console.log('   Enthaltene Daten:');
  console.log(`   • ${backup.metadata.user_count} Benutzer`);
  console.log(`   • ${backup.metadata.settings_count} AE-Settings`);
  console.log(`   • ${backup.metadata.go_lives_count} Go-Lives`);
  console.log(`   • ${backup.metadata.challenges_count} Challenges`);
  console.log('');
  
  if (dryRun) {
    console.log('🔍 DRY-RUN Modus - Keine Änderungen werden vorgenommen.\n');
    console.log('✅ Backup ist gültig und kann wiederhergestellt werden.');
    console.log('   Führe ohne --dry-run aus, um wiederherzustellen.\n');
    process.exit(0);
  }
  
  // Bestätigung anfordern
  console.log('⚠️  WARNUNG: Dies wird folgende Daten ÜBERSCHREIBEN:');
  console.log('   • Alle Go-Lives');
  console.log('   • Alle AE-Settings');
  console.log('   • Alle Challenges');
  console.log('   • Alle Berechtigungen');
  console.log('   • Benutzer-Profile (Accounts bleiben erhalten)\n');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const answer = await new Promise(resolve => {
    rl.question('Bist du sicher? Tippe "JA" zum Fortfahren: ', resolve);
  });
  rl.close();
  
  if (answer !== 'JA') {
    console.log('\n❌ Abgebrochen.\n');
    process.exit(0);
  }
  
  console.log('\n🔄 Starte Wiederherstellung...\n');
  
  // Supabase Client erstellen
  const supabase = await loadSupabase();
  
  const results = [];
  
  try {
    // 1. Challenges
    if (backup.tables.challenges && backup.tables.challenges.length > 0) {
      process.stdout.write('   Challenges... ');
      const { error: delErr } = await supabase.from('challenges').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (delErr) throw new Error(`Challenges löschen: ${delErr.message}`);
      
      const { error: insErr } = await supabase.from('challenges').insert(backup.tables.challenges);
      if (insErr) throw new Error(`Challenges einfügen: ${insErr.message}`);
      
      console.log(`✅ ${backup.tables.challenges.length} wiederhergestellt`);
      results.push(`✅ ${backup.tables.challenges.length} Challenges`);
    }
    
    // 2. Go-Lives
    if (backup.tables.go_lives && backup.tables.go_lives.length > 0) {
      process.stdout.write('   Go-Lives... ');
      const { error: delErr } = await supabase.from('go_lives').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (delErr) throw new Error(`Go-Lives löschen: ${delErr.message}`);
      
      const { error: insErr } = await supabase.from('go_lives').insert(backup.tables.go_lives);
      if (insErr) throw new Error(`Go-Lives einfügen: ${insErr.message}`);
      
      console.log(`✅ ${backup.tables.go_lives.length} wiederhergestellt`);
      results.push(`✅ ${backup.tables.go_lives.length} Go-Lives`);
    }
    
    // 3. AE Settings
    if (backup.tables.ae_settings && backup.tables.ae_settings.length > 0) {
      process.stdout.write('   AE-Settings... ');
      const { error: delErr } = await supabase.from('ae_settings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (delErr) throw new Error(`Settings löschen: ${delErr.message}`);
      
      const { error: insErr } = await supabase.from('ae_settings').insert(backup.tables.ae_settings);
      if (insErr) throw new Error(`Settings einfügen: ${insErr.message}`);
      
      console.log(`✅ ${backup.tables.ae_settings.length} wiederhergestellt`);
      results.push(`✅ ${backup.tables.ae_settings.length} AE-Settings`);
    }
    
    // 4. Role Permissions
    if (backup.tables.role_permissions && backup.tables.role_permissions.length > 0) {
      process.stdout.write('   Berechtigungen... ');
      const { error: permErr } = await supabase.from('role_permissions').upsert(backup.tables.role_permissions, { onConflict: 'role' });
      if (permErr) throw new Error(`Permissions: ${permErr.message}`);
      
      console.log(`✅ ${backup.tables.role_permissions.length} wiederhergestellt`);
      results.push(`✅ ${backup.tables.role_permissions.length} Berechtigungen`);
    }
    
    // 5. Users (nur Profile updaten, keine Löschung!)
    if (backup.tables.users && backup.tables.users.length > 0) {
      process.stdout.write('   Benutzer-Profile... ');
      let updatedCount = 0;
      
      for (const user of backup.tables.users) {
        const { error: updateErr } = await supabase
          .from('users')
          .update({
            name: user.name,
            role: user.role,
            language: user.language,
            employee_id: user.employee_id,
            phone: user.phone,
            region: user.region,
            start_date: user.start_date,
            manager_id: user.manager_id,
          })
          .eq('id', user.id);
        
        if (!updateErr) updatedCount++;
      }
      
      console.log(`✅ ${updatedCount}/${backup.tables.users.length} aktualisiert`);
      results.push(`✅ ${updatedCount} Benutzer-Profile`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('  ✅ WIEDERHERSTELLUNG ERFOLGREICH!');
    console.log('='.repeat(60));
    console.log('\nZusammenfassung:');
    results.forEach(r => console.log(`   ${r}`));
    console.log('\n🎉 Du kannst die App jetzt wieder normal verwenden.\n');
    
  } catch (err) {
    console.log('❌ FEHLER');
    console.error('\n' + '='.repeat(60));
    console.error('  ❌ WIEDERHERSTELLUNG FEHLGESCHLAGEN!');
    console.error('='.repeat(60));
    console.error(`\nFehler: ${err.message}\n`);
    console.error('Bisherige Ergebnisse:');
    results.forEach(r => console.error(`   ${r}`));
    console.error('\n⚠️  Die Datenbank könnte in einem inkonsistenten Zustand sein.');
    console.error('   Versuche es erneut oder kontaktiere den Support.\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n❌ Unerwarteter Fehler:', err.message, '\n');
  process.exit(1);
});
