<script setup lang="ts">
// Tools: the player's game install and their mods (features/game-tools.md).
// Not a board like the others: it works on the game's own files. Phase 1
// reads only: which version is installed (the site follows it), the INI,
// and a mod library kept in this browser with each mod's options and
// whether what it patches exists in this install.

import { computed, ref, watch } from 'vue'
import { GAMES } from '@/model/game'
import { optionProblem, scriptFor, type ModTarget } from '@/model/patchupk'
import {
  addModFiles,
  chooseGameFolder,
  forgetGameFolder,
  readPackage,
  reconnectGameFolder,
  removeMod,
  setOption,
  tools,
  type Mod,
  type ModFile,
} from '@/state/tools'
import { state } from '@/state/store'

const scriptInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const added = ref<string | null>(null)

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const n = await addModFiles([...(input.files ?? [])])
  added.value =
    n === 0
      ? 'Nothing added: a mod is a PatcherGUI script (a .txt with UPK_FILE lines) or a folder of mod files.'
      : null
  input.value = ''
}

const KIND_NAME = {
  lw: GAMES.lw.name,
  lwr: GAMES.lwr.name,
  ew: 'Enemy Within without Long War',
}

/** Read the tables of every package a mod patches, once the install is known. */
watch(
  () => [tools.install, tools.mods.length] as const,
  () => {
    if (!tools.install) return
    const upks = new Set(
      tools.mods.flatMap((m) => m.files.flatMap((f) => f.script?.targets.map((t) => t.upk) ?? [])),
    )
    for (const u of upks) void readPackage(u)
  },
  { immediate: true },
)

/** What the install says about one script's targets. */
function scriptStatus(f: ModFile): { text: string; kind: 'ok' | 'bad' | 'unknown' } {
  const targets = (f.script?.targets ?? []).filter((t) => t.object)
  const upks = [...new Set(f.script?.targets.map((t) => t.upk) ?? [])]
  const where = upks.join(', ')
  const count = `${targets.length} ${targets.length === 1 ? 'object' : 'objects'} in ${where}`
  if (!tools.install) return { text: `patches ${count}`, kind: 'unknown' }
  const missingPkg = upks.filter((u) => tools.packages[u.toLowerCase()] === null)
  if (missingPkg.length)
    return { text: `${missingPkg.join(', ')} is not in your install`, kind: 'bad' }
  if (
    upks.some(
      (u) => tools.packages[u.toLowerCase()] === 'reading' || !(u.toLowerCase() in tools.packages),
    )
  )
    return { text: `patches ${count}; reading your install…`, kind: 'unknown' }
  const compressed = upks.filter((u) => {
    const p = tools.packages[u.toLowerCase()]
    return p && p !== 'reading' && p.compressed
  })
  if (compressed.length)
    return { text: `${compressed.join(', ')} is compressed in your install`, kind: 'bad' }
  const missing = targets.filter((t) => !found(t))
  if (missing.length)
    return {
      text: `patches ${count}; not in your install: ${missing.map((t) => t.object).join(', ')}`,
      kind: 'bad',
    }
  return { text: `patches ${count}; all of them are in your install`, kind: 'ok' }
}
function found(t: ModTarget): boolean {
  const p = tools.packages[t.upk.toLowerCase()]
  return !!p && p !== 'reading' && p.exports.has(t.object)
}

const scripts = (m: Mod) => m.files.filter((f) => f.kind === 'script')
const others = (m: Mod) => m.files.filter((f) => f.kind !== 'script')
const description = (m: Mod) =>
  scripts(m).find((f) => f.script?.description)?.script?.description || m.readme || ''
const authors = (m: Mod) =>
  [
    ...new Set(
      scripts(m)
        .map((f) => f.script?.author)
        .filter(Boolean),
    ),
  ].join(', ')
const forTag = (f: ModFile) => {
  const v = scriptFor(f.path)
  return v === 'lw' ? 'for Long War' : v === 'ew' ? 'for plain Enemy Within' : ''
}
const valueOf = (m: Mod, f: ModFile, option: string) => m.values[f.path]?.[option] ?? ''
const FILE_ROLE: Record<string, string> = {
  package: 'goes into CookedPCConsole',
  config: 'a config file',
  doc: 'notes',
  other: '',
}
/** A mod's package that the install already has (LWR ships Sightlines.u, for one). */
const inCooked = (f: ModFile) =>
  f.kind === 'package' &&
  !!tools.install?.cooked.some((c) => c.toLowerCase() === f.path.split('/').pop()!.toLowerCase())
const size = (n: number) =>
  n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} kB` : `${n} B`

const iniNote = computed(() =>
  tools.install?.ini && state.ini
    ? `${tools.install.ini} loaded: the site's costs are this install's.`
    : tools.install?.kind === 'ew'
      ? ''
      : 'No DefaultGameCore.ini found in Config.',
)
</script>

<template>
  <section class="tools" aria-label="Tools">
    <header class="top">
      <h2>Tools</h2>
      <p class="lead">
        Your game install, your mods and settings. This works on the game's own files rather than on
        a campaign; nothing is uploaded, and for now nothing is changed.
      </p>
    </header>

    <section class="block" aria-labelledby="folder-h">
      <h3 id="folder-h">Game folder</h3>
      <template v-if="!tools.supported">
        <p class="muted">
          Reading the game folder needs Chrome or Edge: Firefox and Safari do not let a page open a
          folder. The mod library below works here too.
        </p>
      </template>
      <template v-else-if="tools.status === 'off'">
        <p>
          <button type="button" class="primary" @click="chooseGameFolder">
            Pick the game folder
          </button>
        </p>
        <p class="muted small">
          The game's folder in your Steam library, such as
          <code>I:\Steam\steamapps\common\XCom-Enemy-Unknown</code> (its <code>XEW</code> or
          <code>XComGame</code> folder works too). Chrome will not open anything under
          <code>Program Files</code>, where Steam puts games unless told otherwise; a game there is
          out of the page's reach for now.
        </p>
      </template>
      <template v-else-if="tools.status === 'needs-permission'">
        <p>
          <button type="button" class="primary" @click="reconnectGameFolder">
            Reconnect {{ tools.folder }}
          </button>
          <button type="button" class="link" @click="forgetGameFolder">Forget it</button>
        </p>
        <p class="muted small">
          The browser asks again after a reload before the page may read it.
        </p>
      </template>
      <p v-else-if="tools.status === 'reading'" class="muted">Reading {{ tools.folder }}…</p>
      <template v-else>
        <dl v-if="tools.install" class="facts">
          <dt>Folder</dt>
          <dd>
            <code>{{ tools.install.path }}</code>
          </dd>
          <dt>Installed</dt>
          <dd>
            <strong>{{ KIND_NAME[tools.install.kind] }}</strong>
            <span v-if="tools.install.kind === 'ew'" class="muted">
              · this site models Long War only</span
            >
            <span v-else class="muted"> · the site now shows this version</span>
          </dd>
          <dt v-if="iniNote">INI</dt>
          <dd v-if="iniNote">{{ iniNote }}</dd>
        </dl>
        <p>
          <button type="button" @click="chooseGameFolder">Pick another folder</button>
          <button type="button" class="link" @click="forgetGameFolder">Forget it</button>
        </p>
      </template>
      <p v-if="tools.error" class="error">{{ tools.error }}</p>
    </section>

    <section class="block" aria-labelledby="mods-h">
      <h3 id="mods-h">Mods</h3>
      <p class="muted small">
        PatcherGUI scripts and mod folders, kept in this browser so a reinstall need not mean
        finding them all again. Each mod's options can be set here; installing them into the game
        comes next.
      </p>
      <p>
        <button type="button" @click="scriptInput?.click()">Add mod scripts</button>
        <button type="button" @click="folderInput?.click()">Add a mod folder</button>
        <input ref="scriptInput" type="file" multiple accept=".txt" hidden @change="onPick" />
        <input
          ref="folderInput"
          type="file"
          webkitdirectory
          hidden
          aria-label="Mod folder"
          @change="onPick"
        />
      </p>
      <p v-if="added" class="error">{{ added }}</p>
      <p v-if="!tools.mods.length" class="muted">No mods yet.</p>

      <article v-for="m in tools.mods" :key="m.id" class="mod" :aria-label="m.name">
        <header class="mod-head">
          <h4>{{ m.name }}</h4>
          <span v-if="authors(m)" class="muted small">by {{ authors(m) }}</span>
          <button
            type="button"
            class="remove"
            :aria-label="`Remove ${m.name}`"
            title="Remove from the library"
            @click="removeMod(m.id)"
          >
            ×
          </button>
        </header>
        <details v-if="description(m)" class="desc">
          <summary>{{ description(m).split('\n')[0] }}</summary>
          <p>{{ description(m).split('\n').slice(1).join('\n') }}</p>
        </details>

        <div v-for="f in scripts(m)" :key="f.path" class="script">
          <p class="script-head">
            <code>{{ f.path }}</code>
            <span v-if="forTag(f)" class="tag">{{ forTag(f) }}</span>
            <span class="status" :class="scriptStatus(f).kind">{{ scriptStatus(f).text }}</span>
          </p>
          <table v-if="f.script?.options.length" class="options">
            <tbody>
              <tr v-for="o in f.script.options" :key="o.name">
                <th>
                  <label :for="`${m.id}-${f.path}-${o.name}`">{{ o.name }}</label>
                </th>
                <td class="input">
                  <input
                    :id="`${m.id}-${f.path}-${o.name}`"
                    :value="valueOf(m, f, o.name)"
                    :placeholder="o.value"
                    class="num"
                    @change="
                      setOption(m.id, f.path, o.name, ($event.target as HTMLInputElement).value)
                    "
                  />
                  <span
                    v-if="valueOf(m, f, o.name) && optionProblem(o.kind, valueOf(m, f, o.name))"
                    class="error small"
                    >{{ optionProblem(o.kind, valueOf(m, f, o.name)) }}</span
                  >
                </td>
                <td class="help small">
                  {{ o.help }}
                  <span class="muted">(script's value: {{ o.value }})</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul v-if="others(m).length" class="files small">
          <li v-for="f in others(m)" :key="f.path">
            <code>{{ f.path }}</code> <span class="muted">{{ size(f.size) }}</span>
            <span v-if="inCooked(f)" class="present"> · already in your CookedPCConsole</span>
            <span v-else-if="FILE_ROLE[f.kind]" class="muted"> · {{ FILE_ROLE[f.kind] }}</span>
          </li>
        </ul>
      </article>
    </section>
  </section>
</template>

<style scoped>
.tools {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 32px;
  max-width: 980px;
}
.top h2 {
  margin: 0;
  font-size: 18px;
}
.lead {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13.5px;
}
.block {
  margin-top: 20px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}
h3 {
  margin: 0 0 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  font-weight: 600;
}
p {
  margin: 6px 0;
  font-size: 13.5px;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 12px;
}
.error {
  color: var(--progress);
}
code {
  font-size: 12px;
  background: var(--node);
  padding: 1px 4px;
  border-radius: 3px;
}
button {
  font-size: 13px;
  padding: 4px 10px;
  margin-right: 6px;
}
button.primary {
  background: var(--accent);
  color: #04131f;
  border: none;
  font-weight: 600;
}
button.link {
  background: none;
  border: none;
  color: var(--accent);
  text-decoration: underline;
  padding: 0;
}
.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 14px;
  margin: 6px 0 10px;
  font-size: 13.5px;
}
.facts dt {
  color: var(--muted);
}
.facts dd {
  margin: 0;
}
.mod {
  border: 1px solid var(--border);
  border-left: 3px solid var(--node-border);
  border-radius: 4px;
  background: var(--panel);
  padding: 8px 12px;
  margin: 10px 0;
}
.mod-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
h4 {
  margin: 0;
  font-size: 14.5px;
}
.remove {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
}
.desc {
  font-size: 12.5px;
  margin: 4px 0;
}
.desc summary {
  cursor: pointer;
  color: var(--muted);
}
.desc p {
  white-space: pre-line;
  font-size: 12.5px;
  color: var(--muted);
}
.script {
  margin-top: 6px;
}
.script-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 4px 0;
}
.tag {
  font-size: 11px;
  color: var(--foundry);
}
.status {
  font-size: 12px;
}
.status.ok {
  color: var(--done-text);
}
.status.bad {
  color: var(--progress);
}
.status.unknown {
  color: var(--muted);
}
.options {
  border-collapse: collapse;
  margin: 4px 0 2px;
  width: 100%;
}
.options th {
  text-align: left;
  font-weight: 600;
  font-size: 12.5px;
  padding: 3px 10px 3px 0;
  white-space: nowrap;
  vertical-align: top;
}
.options td {
  padding: 3px 10px 3px 0;
  vertical-align: top;
}
.options td.input {
  white-space: nowrap;
}
.num {
  width: 70px;
  background: var(--node);
  color: var(--text);
  border: 1px solid var(--node-border);
  border-radius: 4px;
  padding: 2px 6px;
  font: inherit;
  font-size: 13px;
}
.help {
  color: var(--text);
  line-height: 1.4;
}
.files {
  list-style: none;
  padding: 0;
  margin: 6px 0 0;
}
.present {
  color: var(--done-text);
}
.files li {
  padding: 1px 0;
}
</style>
