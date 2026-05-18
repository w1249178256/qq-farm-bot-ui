<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'

const input = ref('')
const format = ref<'auto' | 'hex' | 'base64'>('auto')
const mode = ref<'gate' | 'body'>('gate')
const bodyTransform = ref<'auto' | 'none' | 'decrypt'>('auto')
const bodyType = ref('')
const loading = ref(false)
const loadingTypes = ref(false)
const error = ref('')
const result = ref<any>(null)
const protoTypes = ref<string[]>([])

const filteredTypes = computed(() => {
  const keyword = bodyType.value.trim().toLowerCase()
  if (!keyword)
    return protoTypes.value.slice(0, 80)
  return protoTypes.value.filter(type => type.toLowerCase().includes(keyword)).slice(0, 80)
})

const resultJson = computed(() => {
  if (!result.value)
    return ''
  return JSON.stringify(result.value, null, 2)
})

const primaryBody = computed(() => {
  const decoded = result.value?.decodedBody
  if (decoded?.type && !decoded.error)
    return decoded
  return result.value?.inferredBody || null
})

const bodyCandidates = computed(() => {
  const candidates = result.value?.bodyCandidates
  return Array.isArray(candidates) ? candidates : []
})

const metaRows = computed(() => {
  const meta = result.value?.gate?.meta
  if (!meta)
    return []
  return [
    ['服务', meta.service_name || '-'],
    ['方法', meta.method_name || '-'],
    ['类型', meta.message_type || '-'],
    ['客户端序号', meta.client_seq || '-'],
    ['服务端序号', meta.server_seq || '-'],
    ['错误码', meta.error_code || '0'],
    ['错误信息', meta.error_message || '-'],
  ]
})

async function fetchTypes() {
  loadingTypes.value = true
  try {
    const res = await api.get('/api/protocol/types')
    if (res.data.ok)
      protoTypes.value = Array.isArray(res.data.data) ? res.data.data : []
  }
  finally {
    loadingTypes.value = false
  }
}

async function decodePacket() {
  const payload = input.value.trim()
  if (!payload) {
    error.value = '请输入协议数据'
    result.value = null
    return
  }

  loading.value = true
  error.value = ''
  result.value = null
  try {
    const res = await api.post('/api/protocol/decode', {
      input: payload,
      format: format.value,
      mode: mode.value,
      bodyTransform: bodyTransform.value,
      bodyType: bodyType.value.trim(),
    })
    if (res.data.ok) {
      result.value = res.data.data
    }
    else {
      error.value = res.data.error || '解析失败'
    }
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || '解析失败'
  }
  finally {
    loading.value = false
  }
}

function clearInput() {
  input.value = ''
  result.value = null
  error.value = ''
}

function useType(type: string) {
  bodyType.value = type
}

async function useCandidate(type: string) {
  bodyType.value = type
  await decodePacket()
}

onMounted(fetchTypes)
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 class="text-2xl text-gray-900 font-semibold dark:text-white">
          协议分析
        </h1>
        <div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          GateMessage / EventMessage / protobuf body
        </div>
      </div>
      <div class="flex gap-2">
        <button
          class="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          @click="clearInput"
        >
          <div class="i-carbon-clean" />
          清空
        </button>
        <button
          class="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm text-white transition disabled:cursor-not-allowed disabled:opacity-60 hover:bg-green-700"
          :disabled="loading"
          @click="decodePacket"
        >
          <div :class="loading ? 'i-svg-spinners-90-ring-with-bg' : 'i-carbon-play'" />
          {{ loading ? '解析中' : '解析' }}
        </button>
      </div>
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
      <section class="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
        <div class="grid gap-3 md:grid-cols-4">
          <label class="space-y-1">
            <span class="text-xs text-gray-500 dark:text-gray-400">输入格式</span>
            <select v-model="format" class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
              <option value="auto">自动</option>
              <option value="hex">Hex</option>
              <option value="base64">Base64</option>
            </select>
          </label>
          <label class="space-y-1">
            <span class="text-xs text-gray-500 dark:text-gray-400">解析模式</span>
            <select v-model="mode" class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
              <option value="gate">完整 GateMessage</option>
              <option value="body">仅 Body</option>
            </select>
          </label>
          <label class="space-y-1">
            <span class="text-xs text-gray-500 dark:text-gray-400">Body 处理</span>
            <select v-model="bodyTransform" class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
              <option value="auto">自动</option>
              <option value="none">不解密</option>
              <option value="decrypt">强制解密</option>
            </select>
          </label>
          <label class="space-y-1">
            <span class="text-xs text-gray-500 dark:text-gray-400">Body 类型</span>
            <input
              v-model="bodyType"
              list="proto-types"
              class="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              placeholder="自动识别或手动输入"
            >
            <datalist id="proto-types">
              <option v-for="type in filteredTypes" :key="type" :value="type" />
            </datalist>
          </label>
        </div>

        <textarea
          v-model="input"
          class="mt-4 h-[420px] w-full resize-y rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-5 text-gray-900 outline-none transition focus:border-green-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          spellcheck="false"
          placeholder="粘贴 WebSocket binary frame 的 hex 或 base64"
        />

        <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>{{ input.length }} 字符</span>
          <span>{{ loadingTypes ? '类型加载中' : `${protoTypes.length} 个 proto 类型` }}</span>
        </div>

        <div v-if="bodyType.trim()" class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="type in filteredTypes.slice(0, 8)"
            :key="type"
            class="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 transition hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            @click="useType(type)"
          >
            {{ type }}
          </button>
        </div>
      </section>

      <section class="space-y-4">
        <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {{ error }}
        </div>

        <div class="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
          <div class="mb-3 flex items-center gap-2 text-sm text-gray-800 font-medium dark:text-gray-100">
            <div class="i-carbon-information" />
            摘要
          </div>
          <div v-if="!result" class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            暂无解析结果
          </div>
          <div v-else class="space-y-3">
            <div class="grid grid-cols-2 gap-2 text-sm">
              <div class="rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-900">
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  输入长度
                </div>
                <div class="mt-1 font-mono dark:text-gray-100">
                  {{ result.input?.length || 0 }} bytes
                </div>
              </div>
              <div class="rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-900">
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  Body 长度
                </div>
                <div class="mt-1 font-mono dark:text-gray-100">
                  {{ result.gate?.body?.length ?? result.input?.length ?? 0 }} bytes
                </div>
              </div>
            </div>

            <div v-if="metaRows.length" class="overflow-hidden rounded-md border border-gray-100 dark:border-gray-700">
              <div v-for="row in metaRows" :key="row[0]" class="grid grid-cols-[96px_minmax(0,1fr)] border-b border-gray-100 text-sm last:border-b-0 dark:border-gray-700">
                <div class="bg-gray-50 px-3 py-2 text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  {{ row[0] }}
                </div>
                <div class="truncate px-3 py-2 font-mono text-gray-800 dark:text-gray-100" :title="String(row[1])">
                  {{ row[1] }}
                </div>
              </div>
            </div>

            <div v-if="primaryBody?.type" class="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">
              {{ primaryBody.type }}
              <span v-if="primaryBody.transform"> · {{ primaryBody.transform }}</span>
              <span v-if="primaryBody.inferred"> · 自动猜测</span>
            </div>
            <div v-else-if="result.bodyTypeHint" class="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-300">
              {{ result.bodyTypeHint }}
            </div>

            <div v-if="bodyCandidates.length" class="space-y-2">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                候选类型
              </div>
              <div class="max-h-72 overflow-auto rounded-md border border-gray-100 dark:border-gray-700">
                <button
                  v-for="candidate in bodyCandidates"
                  :key="`${candidate.type}-${candidate.transform}`"
                  class="grid w-full grid-cols-[minmax(0,1fr)_64px_56px] items-center gap-2 border-b border-gray-100 px-3 py-2 text-left text-xs last:border-b-0 transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
                  @click="useCandidate(candidate.type)"
                >
                  <span class="truncate font-mono text-gray-800 dark:text-gray-100" :title="candidate.type">
                    {{ candidate.type }}
                  </span>
                  <span class="rounded bg-gray-100 px-2 py-1 text-center text-gray-600 dark:bg-gray-700 dark:text-gray-200">
                    {{ candidate.transform }}
                  </span>
                  <span class="text-right font-mono text-green-600 dark:text-green-300">
                    {{ candidate.score }}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
          <div class="mb-3 flex items-center gap-2 text-sm text-gray-800 font-medium dark:text-gray-100">
            <div class="i-carbon-code" />
            JSON
          </div>
          <pre class="max-h-[560px] overflow-auto rounded-md bg-gray-950 p-3 text-xs leading-5 text-gray-100">{{ resultJson || '{}' }}</pre>
        </div>
      </section>
    </div>
  </div>
</template>
