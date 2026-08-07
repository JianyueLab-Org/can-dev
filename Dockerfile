# Astro SSR（standalone Node 适配器）。两段式：装依赖 + 构建在前一段，跑的那
# 一段只带 dist/ 和生产依赖 —— node_modules 里 @astrojs/check、typescript、
# tailwind 这些加起来比应用本身大得多，没必要进运行镜像。
FROM oven/bun:1 AS build
WORKDIR /app

# 先只拷 manifest，让依赖层在源码变动时仍然命中缓存。
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# 重装一次，只留生产依赖。--production 会把 devDependencies 摘掉。
RUN rm -rf node_modules && bun install --frozen-lockfile --production

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

# 不用 root 跑。写 uid 而不是名字：Kubernetes 的 runAsNonRoot 只认数字，
# 遇到名字会以「无法确认不是 root」为由拒绝启动容器。
USER 1000

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json

EXPOSE 4321

# 运行时用 node 而不是 bun：适配器产出的是标准 Node 入口，而 node:22-alpine
# 比 bun 的镜像小，也是 Astro 官方测试的那条路。
CMD ["node", "./dist/server/entry.mjs"]
