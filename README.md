# Agente PERXIA · Registro de contratos

Aplicación TypeScript para clasificar contratos recibidos, detectar duplicados y otrosíes, pedir confirmación humana para baja confianza y producir alertas.

## Ejecutar

```bash
npm install
npm run dev
```

Abrir `http://localhost:3000`. La API ofrece `POST /api/chat`, `GET /api/sessions/:id` y `GET /api/health`.

## Demo determinista

```bash
npm run demo
```

La demo no usa una clave de LLM: limpia `out/`, procesa los seis mensajes, confirma `msg-006` en segunda pasada y genera `out/alertas.md`.

## Modelo y variables

Copiar `.env.example` a `.env` si se desea cambiar puerto o topes. El valor por defecto `LLM_PROVIDER=perxia` activa `DeterministicPerxiaAdapter`: interpreta intenciones locales, no consume API ni requiere credenciales, y es el modo recomendado para demo y defensa.

Existe una interfaz `LlmAdapter` y una fábrica en `src/llm/` para separar la interpretación conversacional de las herramientas. Además del modo local, se reutilizó la integración de **OpenCode Go** de `ai_agent-supplier-register`: usa `@anthropic-ai/sdk` contra `https://opencode.ai/inference/go/anthropic`, manda el prompt de `agent/prompt.md`, clasifica la intención con tool use estructurado y conserva `x-opencode-session` por sesión.

Para activarla solo en backend, define en `.env`:

```env
LLM_PROVIDER=opencode-go
OPENCODE_MODEL=minimax-m3
OPENCODE_API_KEY=tu_clave_privada
```

Las herramientas y `contratos_validar` siguen siendo la única fuente de datos registrables. Ninguna clave se expone al frontend, las respuestas de API ni los logs.

## Entregable local

El link de prueba durante la defensa es `http://localhost:3000` tras ejecutar `npm run dev`.
