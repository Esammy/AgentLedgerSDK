/**
 * AgentLedger — Demo Recording Script
 *
 * Showcases four capabilities in sequence:
 *   1. Allowed tool call   — payment logged to chain
 *   2. Policy block        — no_spend_over($500) fires
 *   3. Kill switch         — run halted, next call rejected
 *   4. Chain verification  — tamper-evident audit trail
 *
 * Usage:
 *   npx tsx examples/demo_recording.ts
 *
 * Tune pause speed (default 0.9s per beat):
 *   $env:DEMO_PAUSE_SEC='1.3'; npx tsx examples/demo_recording.ts   # PowerShell
 *   DEMO_PAUSE_SEC=1.3 npx tsx examples/demo_recording.ts           # macOS / Linux
 *
 * Record the terminal, then convert to GIF:
 *   ffmpeg -i recording.mp4 \
 *     -vf "fps=12,scale=820:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
 *     demo.gif
 *
 * Recommended terminal size: 82 × 28   Font: JetBrains Mono 14px
 */

import { AgentLedger, POLICY_TEMPLATES, PolicyBlockError, KillSwitchError } from '../src/index'
import type { ToolCallPayload, PolicyBlockPayload } from '../src/index'

// ─── Timing ───────────────────────────────────────────────────────────────────
const BEAT  = parseFloat(process.env.DEMO_PAUSE_SEC ?? '0.9') * 1000
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const pause = () => sleep(BEAT)
const half  = () => sleep(BEAT * 0.5)
const beat  = () => sleep(BEAT * 0.25)

// ─── ANSI colours ─────────────────────────────────────────────────────────────
const R  = '\x1b[0m'
const BD = '\x1b[1m'
const DM = '\x1b[2m'
const GN = '\x1b[32m'
const RD = '\x1b[31m'
const YL = '\x1b[33m'
const CY = '\x1b[36m'
const BL = '\x1b[34m'
const GR = '\x1b[90m'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pr = (s = '') => process.stdout.write(s + '\n')
const div = () => pr(`${DM}${'─'.repeat(62)}${R}`)

function riskBar(score: number): string {
  const filled = Math.min(10, Math.round(score / 10))
  const color  = score >= 70 ? RD : score >= 40 ? YL : GN
  return `${color}${'█'.repeat(filled)}${DM}${'░'.repeat(10 - filled)}${R}`
}

function shortHash(id: string): string {
  return id.slice(0, 10) + '…'
}

function actionLabel(type: string): string {
  if (type === 'tool_call')    return `${GN}ALLOW ${R}`
  if (type === 'policy_block') return `${RD}BLOCK ${R}`
  return                              `${YL}HALT  ${R}`
}

function toolLabel(entry: { type: string; payload: unknown }): string {
  if (entry.type === 'tool_call')    return (entry.payload as ToolCallPayload).tool_name
  if (entry.type === 'policy_block') {
    // blocked_action may include arguments — extract just the tool name
    const raw = (entry.payload as PolicyBlockPayload).blocked_action
    return raw.split('(')[0].split(' ')[0]
  }
  return entry.type
}

// ─── Demo ─────────────────────────────────────────────────────────────────────
async function main() {
  pr()
  pr(`  ${BD}AgentLedger${R}  ${DM}— runtime trust layer for AI agents${R}`)
  div()
  pr()
  await beat()

  // ── Ledger setup ────────────────────────────────────────────────────────────
  const ledger = new AgentLedger({
    agent_id: 'payment-agent-demo',
    storage:  { type: 'memory' },
    policies: [
      POLICY_TEMPLATES.no_spend_over(500),
      POLICY_TEMPLATES.no_delete(),
    ],
  })

  pr(`  ${DM}agent_id${R}  payment-agent-demo`)
  pr(`  ${DM}storage ${R}  memory`)
  pr(`  ${DM}policies${R}  no_spend_over($500)  ·  no_delete()`)
  pr()
  await half()

  // ── Dummy agent ─────────────────────────────────────────────────────────────
  const myAgent = {
    id: 'payment-agent-demo',
    tools: [
      {
        name: 'create_payment',
        description: 'Create a payment transaction',
        func: async (...args: unknown[]) => {
          const { vendor, amount } = args[0] as { vendor: string; amount: number }
          await sleep(25)
          return { success: true, txn_id: 'txn_' + Math.random().toString(36).slice(2, 8), vendor, amount }
        },
      },
      {
        name: 'send_report',
        description: 'Email a report to stakeholders',
        func: async (...args: unknown[]) => {
          const { to } = args[0] as { to: string }
          await sleep(20)
          return { sent: true, to }
        },
      },
    ],
  }

  const governed = ledger.wrap(myAgent)
  pr(`  ${GN}✓${R}  ${governed.tools!.length} tools wrapped and governed`)
  pr()
  await pause()

  const RUN_ID = 'run-prod-demo'

  await ledger.run(async () => {

    // ── DEMO 1 — Allowed Tool Call ───────────────────────────────────────────
    div()
    pr(`  ${BD}DEMO 1${R}  ${DM}— Allowed Tool Call${R}`)
    div()
    pr()
    await half()

    pr(`  ${CY}▶${R}  create_payment({ vendor: "Stripe Inc", amount: 250 })`)
    await pause()

    const before1 = Date.now()
    await governed.tools![0].func({ vendor: 'Stripe Inc', amount: 250 })
    const dur1 = Date.now() - before1

    const snap1   = await ledger.storage.query({ run_id: RUN_ID })
    const entry1  = snap1[snap1.length - 1]

    pr()
    pr(`     ${DM}risk score${R}  ${entry1.risk_score} / 100  ${riskBar(entry1.risk_score)}`)
    await beat()
    pr(`     ${DM}policy    ${R}  ${GN}PASS${R}`)
    await beat()
    pr(`     ${DM}duration  ${R}  ${dur1}ms`)
    pr()
    await half()

    pr(`  ${GN}✓${R}  Payment processed — $250.00 to Stripe Inc`)
    await beat()
    pr(`  ${BL}⛓${R}  ${GR}entry #${snap1.length}  ${shortHash(entry1.id)}  appended to ledger${R}`)
    pr()
    await pause()

    // ── DEMO 2 — Policy Block ────────────────────────────────────────────────
    div()
    pr(`  ${BD}DEMO 2${R}  ${DM}— Policy Block${R}`)
    div()
    pr()
    await half()

    pr(`  ${CY}▶${R}  create_payment({ vendor: "Unknown Corp", amount: 12500 })`)
    await pause()

    try {
      await governed.tools![0].func({ vendor: 'Unknown Corp', amount: 12500 })
    } catch (e) {
      if (e instanceof PolicyBlockError) {
        const snap2  = await ledger.storage.query({ run_id: RUN_ID })
        const entry2 = snap2[snap2.length - 1]

        pr()
        pr(`     ${DM}risk score${R}  ${entry2.risk_score} / 100  ${riskBar(entry2.risk_score)}`)
        await beat()
        pr(`     ${DM}policy    ${R}  ${RD}FAIL${R}  no_spend_over($500)`)
        pr()
        await half()

        pr(`  ${RD}✗  BLOCKED${R}  — amount $12,500 exceeds policy limit of $500`)
        await beat()
        pr(`  ${BL}⛓${R}  ${GR}entry #${snap2.length}  ${shortHash(entry2.id)}  appended to ledger${R}`)
        pr()
      }
    }
    await pause()

    // ── DEMO 3 — Kill Switch ─────────────────────────────────────────────────
    div()
    pr(`  ${BD}DEMO 3${R}  ${DM}— Kill Switch${R}`)
    div()
    pr()
    await half()

    pr(`  ${CY}▶${R}  ledger.killSwitch("${RUN_ID}")`)
    await half()
    await ledger.killSwitch(RUN_ID)
    pr(`  ${YL}⚡  Kill switch activated${R}  —  run: ${RUN_ID}`)
    pr()
    await pause()

    pr(`  ${CY}▶${R}  send_report({ to: "stakeholders@corp.com" })`)
    await beat()

    try {
      await governed.tools![1].func({ to: 'stakeholders@corp.com' })
    } catch (e) {
      if (e instanceof KillSwitchError || e instanceof PolicyBlockError) {
        pr()
        pr(`  ${RD}✗  HALTED${R}  — run ${RUN_ID} is killed. Call rejected.`)
        pr()
      }
    }
    await pause()

    // ── DEMO 4 — Chain Verification ─────────────────────────────────────────
    div()
    pr(`  ${BD}DEMO 4${R}  ${DM}— Chain Verification${R}`)
    div()
    pr()
    await half()

    const allEntries = await ledger.storage.query({ run_id: RUN_ID })
    pr(`  Verifying SHA-256 chain across ${allEntries.length} entries...`)
    await pause()

    const verification = await ledger.storage.verify(RUN_ID)

    pr()
    pr(`  ${GR}  #   Hash              Tool                 Action   Risk${R}`)
    pr(`  ${DM}  ──────────────────────────────────────────────────────────${R}`)
    await beat()

    for (let i = 0; i < allEntries.length; i++) {
      const e    = allEntries[i]
      const num  = String(i + 1).padEnd(2)
      const hash = shortHash(e.id).padEnd(14)
      const tool = toolLabel(e).slice(0, 20).padEnd(20)
      const act  = actionLabel(e.type)
      const risk = String(e.risk_score).padEnd(3)

      pr(`  ${GR}  ${num}  ${hash}  ${R}${tool}  ${act}  ${GR}${risk}${R}`)
      await beat()
    }

    pr()
    await half()

    if (verification.valid) {
      pr(`  ${GN}✓${R}  Chain intact — no tampering detected`)
    } else {
      pr(`  ${RD}✗${R}  Chain broken at entry #${verification.broken_at}`)
    }
    pr(`  ${GN}✓${R}  Audit log exportable for SOC2 review`)
    pr()
    await half()

    div()
    pr(`  ${BD}AgentLedger${R}  ${GR}github.com/Esammy/AgentLedgerSDK${R}`)
    div()
    pr()

  }, RUN_ID)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
