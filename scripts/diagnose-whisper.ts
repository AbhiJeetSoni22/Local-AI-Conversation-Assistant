/**
 * Controlled Whisper A/B harness (runs YOUR whisper-cli.exe + model; nothing leaves the machine).
 *
 *   npm run diagnose:whisper                      # uses samples/diagnostics/*.wav
 *   npm run diagnose:whisper -- --dir some/dir    # custom fixture folder
 *   npm run diagnose:whisper -- --make-nonspeech  # also writes silence / room-noise / click fixtures first
 *
 * Fixtures: 16 kHz mono 16-bit WAV files. An optional <name>.txt beside a WAV holds the expected text
 * (used for word-error-rate). Speech fixtures can be generated on Windows with scripts/make-speech-fixtures.ps1.
 *
 * What it does
 *  1. Probes `whisper-cli -h` and reports whether the flags this app relies on exist in YOUR build.
 *  2. Runs every fixture under each configuration in CONFIGS (initial-prompt variants; decoder flags untouched).
 *  3. Prints raw vs cleaned output per fixture/config and writes everything to test_output/ (git-ignored).
 *
 * Fixtures are passed through the same WhisperService as the app, including the silence gate, so a fixture
 * reported "gate" is audio the app would never send to Whisper.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { WhisperService } from '../electron/whisperService'
import { getWhisperConfig } from '../electron/whisperConfig'
import { buildInitialPrompt } from '../electron/vocabularyConfig'
import { encodeWav16kMono } from '../src/audio/wavEncoder'

const argv = process.argv.slice(2)
const dirArg = argv.indexOf('--dir') >= 0 ? argv[argv.indexOf('--dir') + 1] : 'samples/diagnostics'
const dir = path.resolve(dirArg)

function makeNonSpeech(): void {
  fs.mkdirSync(dir, { recursive: true })
  let seed = 12345
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
  const noise = (sec: number, rms: number) => Float32Array.from({ length: 16000 * sec }, () => rnd() * rms * Math.sqrt(3))
  const write = (name: string, s: Float32Array) => fs.writeFileSync(path.join(dir, name), encodeWav16kMono(s, 16000).wavBuffer)
  write('nonspeech-silence.wav', new Float32Array(16000 * 5))
  write('nonspeech-room-noise.wav', noise(5, 0.006)) // just above the app's 0.005 whole-chunk gate
  const c = noise(3, 0.003); for (let i = 0; i < 160; i++) c[24000 + i] = 0.8 * (1 - i / 160) * (i % 2 ? -1 : 1)
  write('nonspeech-click.wav', c)
  for (const n of ['nonspeech-silence', 'nonspeech-room-noise', 'nonspeech-click']) fs.writeFileSync(path.join(dir, n + '.txt'), '')
  console.log(`Wrote non-speech fixtures to ${dir}`)
}
if (argv.includes('--make-nonspeech')) makeNonSpeech()

const base = getWhisperConfig()
console.log(`Whisper binary: ${base.binPath}\nModel:          ${base.modelPath}\nFixtures:       ${dir}\n`)

// ---- 1. flag probe -----------------------------------------------------------------------------
const probe = spawnSync(base.binPath, ['-h'], { encoding: 'utf8', windowsHide: true })
const help = `${probe.stdout ?? ''}${probe.stderr ?? ''}`
if (probe.error || !help) {
  console.error(`Could not run "${base.binPath} -h": ${probe.error?.message ?? 'no output'}`)
  process.exit(2)
}
const flags = ['-m', '-f', '-oj', '-of', '-t', '-np', '--prompt', '-l', '-mc', '-nth', '-et', '-lpt', '-nf', '-sns', '--vad']
console.log('Flag support in this build:')
for (const f of flags) console.log(`  ${help.includes(f) ? '✅' : '❌ MISSING'} ${f}`)
const required = ['-m', '-f', '-oj', '-of', '-t', '-np']
if (required.some((f) => !help.includes(f))) { console.error('\nA flag the app relies on is missing from this whisper-cli build.'); process.exit(2) }

// ---- 2. matrix ----------------------------------------------------------------------------------
const CONFIGS: Array<{ name: string; prompt: string }> = [
  { name: 'A current-default (no prompt)', prompt: base.initialPrompt ?? '' },
  { name: 'B no prompt (explicit)', prompt: '' },
  { name: 'C short prompt "LangChain."', prompt: 'LangChain.' },
  { name: 'D vocabulary prompt', prompt: buildInitialPrompt({ disabled: false, customPrompt: undefined }) },
]

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean)
function wer(ref: string, hyp: string): number | null {
  const r = norm(ref), h = norm(hyp)
  if (r.length === 0) return h.length === 0 ? 0 : null // no reference words: any output is an insertion
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...new Array(h.length).fill(0)])
  for (let j = 1; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
  return d[r.length][h.length] / r.length
}

async function main(): Promise<void> {
  if (!fs.existsSync(dir)) { console.error(`\nFixture folder not found: ${dir}\nRun scripts/make-speech-fixtures.ps1 (Windows) and/or add --make-nonspeech.`); process.exit(2) }
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav')).sort()
  if (files.length === 0) { console.error('No .wav fixtures found.'); process.exit(2) }

  const services = new Map(CONFIGS.map((c) => [c.name, new WhisperService({ ...base, initialPrompt: c.prompt })]))
  const results: unknown[] = []
  const summary: Record<string, { n: number; werSum: number; werN: number; hallucinated: number; loops: number }> = {}
  for (const cfg of CONFIGS) summary[cfg.name] = { n: 0, werSum: 0, werN: 0, hallucinated: 0, loops: 0 }

  for (const file of files) {
    const txt = path.join(dir, file.replace(/\.wav$/i, '.txt'))
    const expected = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8').trim() : null
    console.log(`\n=== ${file}${expected !== null ? `   expected: "${expected}"` : ''}`)
    for (const cfg of CONFIGS) {
      const svc = services.get(cfg.name)!
      let row: Record<string, unknown>
      try {
        const r = await svc.transcribe(path.join(dir, file), { timeoutMs: 120000 })
        const gated = r.durationMs === 0 && r.isSilent
        const w = expected !== null && !gated ? wer(expected, r.text) : null
        row = { file, config: cfg.name, gated, raw: r.rawText ?? '', cleaned: r.text, loopTrimmed: !!r.loopTrimmed, ms: r.durationMs, wer: w }
        const s = summary[cfg.name]; s.n++
        if (w !== null) { s.werSum += w; s.werN++ }
        if (expected === '' && r.text.length > 0) s.hallucinated++
        if (r.loopTrimmed) s.loops++
        console.log(`  [${cfg.name}] ${gated ? 'gate (not sent)' : `${r.durationMs}ms`}${w !== null ? ` WER=${(w * 100).toFixed(0)}%` : ''}${r.loopTrimmed ? ' LOOP-TRIMMED' : ''}\n      raw:     ${JSON.stringify(r.rawText ?? '')}\n      cleaned: ${JSON.stringify(r.text)}`)
      } catch (e) {
        row = { file, config: cfg.name, error: String(e) }
        console.log(`  [${cfg.name}] ERROR ${String(e)}`)
      }
      results.push(row)
    }
  }

  console.log('\n=== Summary per configuration ===')
  for (const [name, s] of Object.entries(summary))
    console.log(`${name.padEnd(34)} meanWER=${s.werN ? ((s.werSum / s.werN) * 100).toFixed(1) + '%' : 'n/a'}  hallucinated-on-empty=${s.hallucinated}  loops=${s.loops}`)

  fs.mkdirSync('test_output', { recursive: true })
  const out = path.join('test_output', `whisper-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(out, JSON.stringify({ binary: base.binPath, model: base.modelPath, help: flags.map((f) => [f, help.includes(f)]), results }, null, 2))
  console.log(`\nFull raw results written to ${out} (contains transcript text of your fixtures; keep local).`)
}
main().catch((e) => { console.error(e); process.exit(1) })
