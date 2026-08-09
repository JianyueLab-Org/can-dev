<script setup lang="ts">
import { computed, ref } from "vue";
import { createTranslator } from "@/lib/i18n";
import { useOverlay } from "@/lib/useOverlay";
import AlertBox from "@/components/ui/AlertBox.vue";

/**
 * 「我的应用」的全部交互。
 *
 * 它调的是**本站**的 /api/clients/*，不是 can-api —— 访问令牌留在服务端的会
 * 话 cookie 里，这个组件从头到尾看不到它（原因见 src/lib/session.ts）。
 *
 * 校验也不在这里做第二遍。回调地址是不是 https、应用名是不是像官方的，规则
 * 只有 can-api 的 registry.go 说了算；这里把它返回的 message 原样显示出来。
 * 前端再抄一份的下场是两份规则慢慢对不上，而**宽的那一份**会先被人发现。
 *
 * 颜色一律走设计系统的语义记号（`badge-*`、`AlertBox`、`bg-surface-*`），不
 * 写 `bg-red-50`/`bg-slate-100` 这类固定色阶。这个文件原来通篇是后者，于是深
 * 色模式下每一个提示框都是浅底深字 —— 而这个站从建站起就跟随系统深色，也就
 * 是说它一直是坏的，只是没人在深色下打开过。
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
  /** `dev.apps` 那一支词典，服务端解好传进来。 */
  messages: Record<string, unknown>;
}>();

const t = createTranslator(props.messages);

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
  editing.value ? t("form.editTitle") : t("form.createTitle"),
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
      error.value =
        body.message || t("requestFailed", { status: response.status });
      return null;
    }
    return body.data as T;
  } catch {
    error.value = t("networkError");
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
 *
 * 开关是**两个** ref：`deleteOpen` 是给 `useOverlay` 的布尔量（Escape 会直接
 * 写它），`deleting` 是删谁。合成一个 `ref<Client|null>` 的话 useOverlay 关不
 * 掉它 —— 它只会把值设成 `false`，而模板判的是「不是 null」。
 */
const deleting = ref<ManagedClient | null>(null);
const deleteOpen = ref(false);
const deleteTyped = ref("");
const deletePanel = useOverlay(deleteOpen);

function openDelete(client: ManagedClient) {
  deleting.value = client;
  deleteTyped.value = "";
  deleteOpen.value = true;
}

function closeDelete() {
  deleteOpen.value = false;
  deleting.value = null;
  deleteTyped.value = "";
}

async function confirmDelete() {
  if (!deleting.value || deleteTyped.value !== deleting.value.name) return;
  const done = await send<{ deleted: boolean }>(
    `/api/clients/${deleting.value.id}`,
    { method: "DELETE" },
  );
  if (done) {
    closeDelete();
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
      <p class="text-sm text-muted">
        {{ t("count", { count: clients.length }) }}
      </p>
      <button class="btn btn-primary" :disabled="busy" @click="openCreate">
        {{ t("register") }}
      </button>
    </div>

    <AlertBox v-if="error" variant="danger" class="mb-4">{{ error }}</AlertBox>

    <!-- 密钥只在这一刻存在。刷新之后就再也拿不到了，所以说得直白些。 -->
    <AlertBox
      v-if="freshSecret"
      variant="warning"
      :title="t('secret.title')"
      class="mb-4"
    >
      <p>{{ t("secret.detail") }}</p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <code
          class="min-w-0 flex-1 overflow-x-auto rounded-control bg-surface px-3 py-2 font-mono text-xs text-ink"
          >{{ freshSecret.secret }}</code
        >
        <button
          class="btn btn-primary px-3 py-1.5 text-xs"
          @click="copy(freshSecret.secret)"
        >
          {{ t("secret.copy") }}
        </button>
        <button
          class="btn btn-ghost px-3 py-1.5 text-xs"
          @click="freshSecret = null"
        >
          {{ t("secret.done") }}
        </button>
      </div>
    </AlertBox>

    <!-- 表单 -->
    <div v-if="creating" class="card mb-6">
      <h2 class="mb-4 font-semibold text-ink">{{ formTitle }}</h2>

      <div class="grid gap-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-ink" for="f-name">{{
            t("form.name")
          }}</label>
          <input id="f-name" v-model="form.name" class="input" />
          <p class="mt-1 text-xs text-faint">{{ t("form.nameHint") }}</p>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-ink" for="f-uris">{{
            t("form.redirectUris")
          }}</label>
          <textarea
            id="f-uris"
            v-model="form.redirectUris"
            class="input"
            rows="3"
          />
          <p class="mt-1 text-xs text-faint">
            {{ t("form.redirectUrisHint") }}
          </p>
        </div>

        <fieldset>
          <legend class="mb-1 block text-sm font-medium text-ink">
            {{ t("form.scopes") }}
          </legend>
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
            <label
              class="mb-1 block text-sm font-medium text-ink"
              for="f-site"
              >{{ t("form.website") }}</label
            >
            <input id="f-site" v-model="form.websiteUrl" class="input" />
          </div>
          <div>
            <label
              class="mb-1 block text-sm font-medium text-ink"
              for="f-logo"
              >{{ t("form.logo") }}</label
            >
            <input id="f-logo" v-model="form.logoUrl" class="input" />
          </div>
        </div>

        <!-- 注册后不能改：改它等于换一种证明身份的方式。 -->
        <label v-if="!editing" class="flex items-start gap-2 text-sm">
          <input v-model="form.isPublic" type="checkbox" class="mt-1" />
          <span>
            <span class="text-ink">{{ t("form.publicClient") }}</span>
            <span class="block text-xs text-faint">
              {{ t("form.publicClientHint") }}
            </span>
          </span>
        </label>
      </div>

      <div class="mt-5 flex gap-2">
        <button class="btn btn-primary" :disabled="busy" @click="submit">
          {{ editing ? t("form.save") : t("form.create") }}
        </button>
        <button class="btn btn-ghost" :disabled="busy" @click="close">
          {{ t("form.cancel") }}
        </button>
      </div>
    </div>

    <!-- 列表 -->
    <p v-if="!clients.length" class="card text-sm text-muted">
      {{ t("empty") }}
    </p>

    <ul class="grid gap-4">
      <li v-for="client in clients" :key="client.id" class="card">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h3
              class="flex flex-wrap items-center gap-2 font-semibold text-ink"
            >
              {{ client.name }}
              <span v-if="client.disabled" class="badge badge-danger">{{
                t("card.disabled")
              }}</span>
              <span
                v-else-if="client.activeTokens"
                class="badge badge-success"
                >{{
                  t("card.activeTokens", { count: client.activeTokens })
                }}</span
              >
              <span v-if="client.isPublic" class="badge badge-neutral">{{
                t("card.publicClient")
              }}</span>
            </h3>
            <button
              class="mt-1 font-mono text-xs text-faint hover:text-ink"
              :title="t('card.copyClientId')"
              @click="copy(client.id)"
            >
              {{ client.id }}
            </button>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              class="btn btn-ghost px-3 py-1.5 text-xs"
              @click="openEdit(client)"
            >
              {{ t("card.edit") }}
            </button>
            <button
              v-if="!client.isPublic"
              class="btn btn-ghost px-3 py-1.5 text-xs"
              :disabled="busy"
              @click="rotate(client)"
            >
              {{ t("card.rotate") }}
            </button>
            <button
              class="btn btn-ghost px-3 py-1.5 text-xs"
              :disabled="busy"
              @click="toggle(client)"
            >
              {{ client.disabled ? t("card.enable") : t("card.disable") }}
            </button>
            <button
              class="btn btn-danger px-3 py-1.5 text-xs"
              @click="openDelete(client)"
            >
              {{ t("card.delete") }}
            </button>
          </div>
        </div>

        <dl class="mt-4 grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt class="text-faint">{{ t("card.redirectUris") }}</dt>
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
            <dt class="text-faint">{{ t("card.scopes") }}</dt>
            <dd class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="scope in client.scopes"
                :key="scope"
                class="badge badge-neutral"
                >{{ scope }}</span
              >
            </dd>
          </div>
        </dl>
      </li>
    </ul>

    <!-- 删除确认 -->
    <div
      v-if="deleteOpen && deleting"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        class="animate-overlay-in absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
        @click="closeDelete"
      ></div>
      <div
        ref="deletePanel"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        class="animate-panel-in card relative w-full max-w-md overscroll-contain"
      >
        <h3 id="delete-title" class="font-semibold text-ink">
          {{ t("delete.title", { name: deleting.name }) }}
        </h3>
        <p class="mt-2 text-sm leading-relaxed text-muted">
          {{ t("delete.detail") }}
        </p>
        <input
          v-model="deleteTyped"
          class="input mt-3"
          :placeholder="deleting.name"
        />
        <div class="mt-4 flex justify-end gap-2">
          <button class="btn btn-ghost" @click="closeDelete">
            {{ t("delete.cancel") }}
          </button>
          <button
            class="btn btn-danger"
            :disabled="busy || deleteTyped !== deleting.name"
            @click="confirmDelete"
          >
            {{ t("delete.confirm") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
