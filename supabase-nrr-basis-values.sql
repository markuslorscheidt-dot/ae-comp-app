-- ============================================================================
-- NRR Basis Values (JSONB in dlt_planzahlen.expanding_arr_data.nrr_basis)
-- ============================================================================
-- Kein ALTER TABLE: expanding_arr_data ist JSONB.
--
-- {
--   "nrr_basis": {
--     "arr_basis_dec": 6101887,      -- optional: ARR Referenz 31.12. Vorjahr (nur UI/Kontext)
--     "arr_basis_jan_end": 6079817   -- Pflicht fuer NRR: ARR Ende Januar Planjahr (Berechnungsbasis)
--   }
-- }
--
-- SMS/Pay-Deltas: Referenzmonat Januar aus Importen (keine manuellen Dezember-Felder mehr).

COMMENT ON COLUMN dlt_planzahlen.expanding_arr_data IS
  'Expanding ARR inkl. nrr_basis (arr_basis_jan_end = NRR-Berechnungsbasis, arr_basis_dec = optionale 31.12.-Referenz)';
