import { cleanOutput } from './src/tools/contratos.js'

await cleanOutput(process.cwd())
console.log('Estado de demostración reiniciado: out/ fue limpiado; fixtures permanecen intactos.')
