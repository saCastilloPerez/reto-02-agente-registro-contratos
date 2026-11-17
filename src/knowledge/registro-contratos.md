# Conocimiento del proceso

El buzón único recibe contratos firmados, otrosíes y actas de terminación. Un contrato con póliza se registra con estado `pendiente` hasta que administración confirme su vigencia. Los otrosíes actualizan el contrato base y conservan historial. Los documentos de cotización no se registran.

El maestro congelado es de solo lectura. La operación escribe únicamente copias bajo `out/sharepoint/` y conserva trazabilidad en `out/log.jsonl`.
