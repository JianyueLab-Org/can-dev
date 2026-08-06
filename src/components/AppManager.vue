<script setup lang="ts">
import { computed, ref } from "vue";

/**
 * 「我的应用」的全部交互。
 *
 * 它调的是**本站**的 /api/clients/*，不是 can-web —— 访问令牌留在服务端的会
 * 话 cookie 里，这个组件从头到尾看不到它（原因见 src/lib/session.ts）。
 *
 * 校验也不在这里做第二遍。回调地址是不是 https、应用名是不是像官方的，规则
 * 只有 can-web 的 registry.ts 说了算；这里把它返回的 message 原样显示出来。
 * 前端再抄一份的下场是两份规则慢慢对不上，而**宽的那一份**会先被人发现。
 */

interface ManagedClient {
  id: string;
  name: string;
  isPublic: boolean;
  redirectUris: string[];
  scopes: string[];
  logoUrl: string | null;
  websiteUrl: string | null;
  disabled: boolean;
  createdAt: string;
  activeTokens?: number;
}

const props = defineProps<{
  initial: ManagedClient[];
  scopes: { name: string; title: string; detail: string }[];
}>();

const clients = ref<ManagedClient[]>([...props.initial]);
const busy = ref(false);
const error = ref("");
/** 刚生成、只出现这一次的密钥。key 是 client id。 */
const freshSecret = ref<{ id: string; secret: string } | null>(null);

const editing = ref<string | null>(null);
const creating = ref(false);

const blank = () => ({
  name: "",
  redirectUris: "",
  scopes: ["openid", "profile"] as string[],
  websiteUrl: "",
  logoUrl: "",
  isPublic: false,
});
const form = ref(blank());

const formTitle = computed(() =>
  editing.value ? "修改应用" : "注册一个新应用",
);

function openCreate() {
  form.value = blank();
  editing.value = null;
  creating.value = true;
  error.value = "";
}

function openEdit(client: ManagedClient) {
  form.value = {
    name: client.name,
    redirectUris: client.redirectUris.join("\n"),
    scopes: [...client.scopes],
    websiteUrl: client.websiteUrl ?? "",
    logoUrl: client.logoUrl ?? "",
    isPublic: client.isPublic,
  };
  editing.value = client.id;
  creating.value = true;
  error.value = "";
}

function close() {
  creating.value = false;
  editing.value = null;
}

/** 所有请求走这里，好让「正在忙」和错误显示只写一遍。 */
async function send<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  busy.value = true;
  error.value = "";
  try {
    const response = await fetch(path, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      error.value = body.message || `请求失败（${response.status}）`;
      return null;
    }
    return body.data as T;
  } catch {
    error.value = "网络不通，稍后再试。";
    return null;
  } finally {
    busy.value = false;
  }
}

async function refresh() {
  const data = await send<ManagedClient[]>("/api/clients");
  if (data) clients.value = data;
}

async function submit() {
  const payload = {
    name: form.value.name,
    redirectUris: form.value.redirectUris
      .split("\n")
      .map((uri) => uri.trim())
      .filter(Boolean),
    scopes: form.value.scopes,
    websiteUrl: form.value.websiteUrl || null,
    logoUrl: form.value.logoUrl || null,
    ...(editing.value ? {} : { isPublic: form.value.isPublic }),
  };

  const data = editing.value
    ? await send<ManagedClient>(`/api/clients/${editing.value}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
    : await send<ManagedClient & { clientSecret?: string | null }>(
        "/api/clients",
        { method: "POST", body: JSON.stringify(payload) },
      );

  if (!data) return;
  if (!editing.value && "clientSecret" in data && data.clientSecret) {
    freshSecret.value = { id: data.id, secret: data.clientSecret };
  }
  close();
  await refresh();
}

async function rotate(client: ManagedClient) {
  const data = await send<{ clientSecret: string }>(
    `/api/clients/${client.id}/secret`,
    { method: "POST" },
  );
  if (data) freshSecret.value = { id: client.id, secret: data.clientSecret };
}

async function toggle(client: ManagedClient) {
  const data = await send<ManagedClient>(`/api/clients/${client.id}`, {
    method: "PATCH",
    body: JSON.stringify({ disabled: !client.disabled }),
  });
  if (data) await refresh();
}

/**
 * 删除要打字确认。
 *
 * 不用 confirm()：这一步是不可逆的，而且删掉的是别人正在用来登录的东西 ——
 * 一个能靠肌肉记忆点掉的确认框拦不住手滑。要求把应用名抄一遍，成本正好。
 */
const deleting = ref<ManagedClient | null>(null);
const deleteTyped = ref("");

async function confirmDelete() {
  if (!deleting.value || deleteTyped.value !== deleting.value.name) return;
  const done = await send<{ deleted: boolean }>(
    `/api/clients/${deleting.value.id}`,
    { method: "DELETE" },
  );
  if (done) {
    deleting.value = null;
    deleteTyped.value = "";
    await refresh();
  }
}

function copy(text: string) {
  navigator.clipboard?.writeText(text);
}
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between gap-4">
      <p class="text-sm text-muted">{{ clients.length }} 个应用</p>
      <button class="btn" :disabled="busy" @click="openCreate">
        注册新应用
      </button>
    </div>

    <p
      v-if="error"
      class="card mb-4 border-red-300 bg-red-50 text-sm text-red-900"
      role="alert"
    >
      {{ error }}
    </p>

    <!-- 密钥只在这一刻存在。刷新之后就再也拿不到了，所以说得直白些。 -->
    <div
      v-if="freshSecret"
      class="card mb-4 border-amber-300 bg-amber-50 text-amber-950"
    >
      <h3 class="font-medium">这是 client_secret，只显示这一次</h3>
      <p class="mt-1 text-sm">
        我们只存它的哈希，关掉之后谁也找不回来。丢了就得再换一把。
      </p>
      <div class="mt-3 flex items-center gap-2">
        <code
          class="flex-1 overflow-x-auto rounded-[var(--radius-control)] bg-white px-3 py-2 font-mono text-xs"
          >{{ freshSecret.secret }}</code
        >
        <button class="btn btn-sm" @click="copy(freshSecret.secret)">
          复制
        </button>
        <button class="btn btn-ghost btn-sm" @click="freshSecret = null">
          我抄好了
        </button>
      </div>
    </div>

    <!-- 表单 -->
    <div v-if="creating" class="card mb-6">
      <h2 class="mb-4 font-medium text-ink">{{ formTitle }}</h2>

      <div class="grid gap-4">
        <div>
          <label class="label" for="f-name">应用名</label>
          <input id="f-name" v-model="form.name" class="input" />
          <p class="hint">
            成员在授权页上看到的就是这个名字。不能让人误以为它是网络官方的应用。
          </p>
        </div>

        <div>
          <label class="label" for="f-uris">回调地址</label>
          <textarea
            id="f-uris"
            v-model="form.redirectUris"
            class="input"
            rows="3"
          />
          <p class="hint">
            一行一个，整串精确匹配。只收 https；本机调试用
            http://127.0.0.1（端口可变），移动端可用带点的私有 scheme。
          </p>
        </div>

        <fieldset>
          <legend class="label">申请的权限</legend>
          <label
            v-for="scope in props.scopes"
            :key="scope.name"
            class="flex items-start gap-2 py-1 text-sm"
          >
            <input
              v-model="form.scopes"
              type="checkbox"
              :value="scope.name"
              class="mt-1"
            />
            <span>
              <span class="text-ink">{{ scope.title }}</span>
              <span class="block text-xs text-faint">{{ scope.detail }}</span>
            </span>
          </label>
        </fieldset>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="f-site">主页（可选）</label>
            <input id="f-site" v-model="form.websiteUrl" class="input" />
          </div>
          <div>
            <label class="label" for="f-logo">图标地址（可选）</label>
            <input id="f-logo" v-model="form.logoUrl" class="input" />
          </div>
        </div>

        <!-- 注册后不能改：改它等于换一种证明身份的方式。 -->
        <label v-if="!editing" class="flex items-start gap-2 text-sm">
          <input v-model="form.isPublic" type="checkbox" class="mt-1" />
          <span>
            <span class="text-ink">这是公共客户端</span>
            <span class="block text-xs text-faint">
              桌面端、移动端、纯前端应用 —— 存不住密钥的那些。不发
              client_secret，靠 PKCE 证明自己。注册后不可更改。
            </span>
          </span>
        </label>
      </div>

      <div class="mt-5 flex gap-2">
        <button class="btn" :disabled="busy" @click="submit">
          {{ editing ? "保存" : "注册" }}
        </button>
        <button class="btn btn-ghost" :disabled="busy" @click="close">
          取消
        </button>
      </div>
    </div>

    <!-- 列表 -->
    <p v-if="!clients.length" class="card text-sm text-muted">
      还没有应用。注册一个，就能让成员用 CAN 账号登录它。
    </p>

    <ul class="grid gap-4">
      <li v-for="client in clients" :key="client.id" class="card">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="flex items-center gap-2 font-medium text-ink">
              {{ client.name }}
              <span v-if="client.disabled" class="badge bg-red-100 text-red-800"
                >已停用</span
              >
              <span
                v-else-if="client.activeTokens"
                class="badge bg-green-100 text-green-800"
                >{{ client.activeTokens }} 个令牌在用</span
              >
              <span
                v-if="client.isPublic"
                class="badge bg-slate-100 text-slate-700"
                >公共客户端</span
              >
            </h3>
            <button
              class="mt-1 font-mono text-xs text-faint hover:text-ink"
              title="复制 client_id"
              @click="copy(client.id)"
            >
              {{ client.id }}
            </button>
          </div>

          <div class="flex flex-wrap gap-2">
            <button class="btn btn-ghost btn-sm" @click="openEdit(client)">
              修改
            </button>
            <button
              v-if="!client.isPublic"
              class="btn btn-ghost btn-sm"
              :disabled="busy"
              @click="rotate(client)"
            >
              换密钥
            </button>
            <button
              class="btn btn-ghost btn-sm"
              :disabled="busy"
              @click="toggle(client)"
            >
              {{ client.disabled ? "启用" : "停用" }}
            </button>
            <button
              class="btn btn-danger btn-sm"
              @click="
                deleting = client;
                deleteTyped = '';
              "
            >
              删除
            </button>
          </div>
        </div>

        <dl class="mt-4 grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt class="text-faint">回调地址</dt>
            <dd class="mt-1 space-y-0.5">
              <code
                v-for="uri in client.redirectUris"
                :key="uri"
                class="block overflow-x-auto font-mono text-muted"
                >{{ uri }}</code
              >
            </dd>
          </div>
          <div>
            <dt class="text-faint">权限</dt>
            <dd class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="scope in client.scopes"
                :key="scope"
                class="badge bg-slate-100 text-slate-700"
                >{{ scope }}</span
              >
            </dd>
          </div>
        </dl>
      </li>
    </ul>

    <!-- 删除确认 -->
    <div
      v-if="deleting"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div class="card w-full max-w-md">
        <h3 class="font-medium text-ink">删除「{{ deleting.name }}」？</h3>
        <p class="mt-2 text-sm text-muted">
          连同它的令牌和成员的授权记录一起删掉，不可撤销。正在用它登录的人会立刻
          被挡在外面。确认的话，把应用名抄一遍：
        </p>
        <input
          v-model="deleteTyped"
          class="input mt-3"
          :placeholder="deleting.name"
        />
        <div class="mt-4 flex justify-end gap-2">
          <button class="btn btn-ghost" @click="deleting = null">取消</button>
          <button
            class="btn btn-danger"
            :disabled="busy || deleteTyped !== deleting.name"
            @click="confirmDelete"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
