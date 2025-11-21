<template>
  <div class="richtext-editor border rounded-md">
    <!-- Toolbar -->
    <div class="toolbar flex flex-wrap items-center gap-2 p-2 border-b">
      <!-- Formatting (only meaningful in WYSIWYG mode) -->
      <div class="flex gap-1">
        <button type="button" @click="exec('bold')" :disabled="mode !== 'design'"><b>B</b></button>
        <button type="button" @click="exec('italic')" :disabled="mode !== 'design'"><i>I</i></button>
        <button type="button" @click="exec('underline')" :disabled="mode !== 'design'"><u>U</u></button>
        <button type="button" @click="exec('strikeThrough')" :disabled="mode !== 'design'"><s>S</s></button>

        <button type="button" @click="exec('insertUnorderedList')" :disabled="mode !== 'design'">• UL</button>
        <button type="button" @click="exec('insertOrderedList')" :disabled="mode !== 'design'">1. OL</button>

        <button type="button" @click="exec('outdent')" :disabled="mode !== 'design'">⇤</button>
        <button type="button" @click="exec('indent')" :disabled="mode !== 'design'">⇥</button>

        <select @change="execFont($event, 'fontName')" :disabled="mode !== 'design'">
          <option value="">Font</option>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Verdana">Verdana</option>
        </select>

        <select @change="execFont($event, 'fontSize')" :disabled="mode !== 'design'">
          <option value="">Size</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3 (Normal)</option>
          <option value="4">4</option>
          <option value="5">5</option>
          <option value="6">6</option>
          <option value="7">7</option>
        </select>
      </div>

      <!-- Mode controls -->
      <div class="ml-auto flex gap-1">
        <select v-model="mode" class="border px-2 py-1 rounded">
          <option value="design">Rich (Design)</option>
          <option value="html">HTML Source</option>
          <option value="plain">Plain Text</option>
          <option value="preview">Preview</option>
        </select>
      </div>
    </div>

    <!-- WYSIWYG editor (sandboxed iframe) -->
    <div v-if="mode === 'design'" class="editor-wrapper">
      <iframe
        height="100%"
        ref="editorFrame"
        class="w-full border preview-frame"
        sandbox="allow-same-origin allow-scripts"
        title="wysiwyg-editor"
      ></iframe>
    </div>

    <!-- HTML Source textarea -->
    <textarea
      v-else-if="mode === 'html'"
      v-model="rawHtml"
      class="w-full border rounded p-2 text-xs font-mono"
      rows="50"
    ></textarea>

    <!-- Plain text textarea -->
    <textarea
      v-else-if="mode === 'plain'"
      v-model="plainTextRaw"
      class="w-full border rounded p-2 text-sm"
      rows="50"
      placeholder="Write plain text..."
    ></textarea>

    <!-- Preview -->
    <iframe
      v-else-if="mode === 'preview'"
      height="100%"
      ref="previewFrame"
      class="w-full border preview-frame"
      sandbox="allow-same-origin"
      title="html-preview"
    ></iframe>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from "vue";

const props = defineProps<{ modelValue?: string }>();
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "dirty"): void;
}>();

// single source of truth for HTML
const internalHtml = ref(props.modelValue ?? "");
const rawHtml = ref(internalHtml.value);            // HTML textarea model
const plainTextRaw = ref(stripHtml(internalHtml.value)); // Plain text textarea

// UI state
const mode = ref<'design' | 'html' | 'plain' | 'preview'>('design');

const editorFrame = ref<HTMLIFrameElement | null>(null);
const previewFrame = ref<HTMLIFrameElement | null>(null);

// guards to avoid feedback loops when programmatically setting iframe content
const isSettingIframe = ref(false);

/* ------------------ Sync external prop -> internal ------------------ */
watch(
  () => props.modelValue,
  (v) => {
    const val = v ?? "";
    if (val !== internalHtml.value) {
      internalHtml.value = val;
      rawHtml.value = val;
      plainTextRaw.value = stripHtml(val);
      // update editor/preview if visible
      if (mode.value === 'design') nextTick(syncIframeWithInternal);
      if (mode.value === 'preview') nextTick(renderPreview);
    }
  }
);

/* ------------------ internal -> emit & update dependent UI ------------------ */
watch(internalHtml, (v) => {
  // keep textarea models in sync
  rawHtml.value = v;
  plainTextRaw.value = stripHtml(v);

  emit("update:modelValue", v);
  emit("dirty");
  // update visible frames
  if (mode.value === 'design') nextTick(syncIframeWithInternal);
  if (mode.value === 'preview') nextTick(renderPreview);
});

/* ------------------ textareas -> internal ------------------ */
watch(rawHtml, (v) => {
  if (mode.value === 'html') {
    internalHtml.value = v;
  }
});
watch(plainTextRaw, (v) => {
  if (mode.value === 'plain') {
    internalHtml.value = plainToHtml(v);
  }
});

/* ------------------ mode switching handler ------------------ */
watch(mode, (m, old) => {
  if (m === 'design') {
    // put the latest HTML into the editor iframe
    nextTick(initOrSyncIframe);
  } else if (m === 'html') {
    rawHtml.value = internalHtml.value;
  } else if (m === 'plain') {
    plainTextRaw.value = stripHtml(internalHtml.value);
  } else if (m === 'preview') {
    nextTick(renderPreview);
  }
});

/* ------------------ iframe (wysiwyg) helpers ------------------ */
function initOrSyncIframe() {
  if (!editorFrame.value) return;
  const doc = editorFrame.value.contentDocument;
  if (!doc) return;

  // If iframe is blank, initialize; otherwise just sync body HTML (without clobber during typing)
  if (!doc.body || doc.body.getAttribute('data-rich-init') !== 'true') {
    initIframe();
  } else {
    syncIframeWithInternal();
  }
}

function initIframe() {
  if (!editorFrame.value) return;
  const doc = editorFrame.value.contentDocument!;
  const baseStyle = `
    html,body { height:100%; margin:0; }
    body { font-family: Arial, sans-serif; font-size:14px; padding:8px; color:#111; }
    img { max-width:100%; height:auto; }
    table { border-collapse: collapse; }
  `;

  isSettingIframe.value = true;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head>
    <body contenteditable="true" data-rich-init="true">${internalHtml.value || ''}</body></html>`);
  doc.close();

  // 🔥 Emit on every user input
  doc.body!.addEventListener('input', () => {
    if (isSettingIframe.value) return;
    const newVal = doc.body!.innerHTML;
    if (newVal !== internalHtml.value) {
      internalHtml.value = newVal;   // triggers emit via watch(internalHtml)
    }
  });

  // paste sanitization - paste as plain text
  doc.body!.addEventListener('paste', (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    (doc as any).execCommand('insertText', false, text);
  });

  // give a tick for the browser to settle before removing the guard
  setTimeout(() => { isSettingIframe.value = false; }, 0);
}

function syncIframeWithInternal() {
  if (!editorFrame.value) return;
  const doc = editorFrame.value.contentDocument!;
  if (!doc.body) return;

  // Only set if different to avoid clobbering user's caret/selection
  if (doc.body.innerHTML !== internalHtml.value) {
    isSettingIframe.value = true;
    doc.body.innerHTML = internalHtml.value || "";
    // clear guard soon after
    setTimeout(() => { isSettingIframe.value = false; }, 0);
  }
}

function getIframeContent(): string {
  const doc = editorFrame.value?.contentDocument;
  return doc?.body?.innerHTML ?? "";
}

/* Exec commands inside iframe (when design mode) */
function exec(command: string, value?: string | null) {
  if (mode.value !== 'design') return;
  const doc = editorFrame.value?.contentDocument;
  if (!doc?.body) return;
  (doc as any).execCommand(command, false, value ?? null);

  // 🔥 Immediately push changes back to internal + emit
  const newVal = doc.body.innerHTML;
  if (newVal !== internalHtml.value) {
    internalHtml.value = newVal;
  }
}

function execFont(e: Event, command: string) {
  const val = (e.target as HTMLSelectElement).value;
  if (!val) return;
  exec(command, val);
}

/* ------------------ preview rendering ------------------ */
const previewStyles = `
  body { font-family: Arial, sans-serif; padding: 10px; margin:0; color:#111; }
  img { max-width:100%; height:auto; }
  table { border-collapse:collapse; }
`;

function renderPreview() {
  if (!previewFrame.value) return;
  const doc = previewFrame.value.contentDocument || previewFrame.value.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${previewStyles}</style></head><body>${internalHtml.value || ""}</body></html>`);
  doc.close();
}

/* ------------------ Utilities ------------------ */
function stripHtml(html: string) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent || div.innerText || "";
}
function escapeHtml(unsafe: string) {
  return unsafe.replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' } as any)[m];
  });
}
function plainToHtml(plain: string) {
  if (!plain) return "";
  const lines = plain.split(/\r?\n/);
  return lines.map(l => `<p>${escapeHtml(l) || '&nbsp;'}</p>`).join("");
}

/* ------------------ lifecycle ------------------ */
onMounted(() => {
  // initialize editor iframe if starting in design mode
  if (mode.value === 'design') nextTick(initOrSyncIframe);
  if (mode.value === 'preview') nextTick(renderPreview);
});
</script>

<style scoped>
.toolbar button,
.toolbar select {
  padding: 4px 8px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.toolbar button[disabled],
.toolbar select[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}
.toolbar .active {
  background: #eef2ff;
}
.editor-wrapper { height: 80vh; }   /* design iframe wrapper */
.editor-frame   { width: 100%; height: 80vh; border: 1px solid #e5e7eb; }
textarea        { width: 100%; height: 80vh; border: 1px solid #e5e7eb; padding: 8px; }
</style>
