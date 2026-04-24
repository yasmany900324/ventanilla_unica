-- Post-migration diagnostics for procedure-only catalog mode.
-- Expected result: no active rows with case_type = 'incident'.

SELECT id, code, name, case_type, is_active, camunda_process_id
FROM chatbot_procedure_catalog
WHERE is_active = TRUE
ORDER BY case_type, code;
