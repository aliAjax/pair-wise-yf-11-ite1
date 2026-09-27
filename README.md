# 古籍拓片缺损修补API

纯后端零依赖Node服务，使用 `data/db.json` 持久化拓片、缺损项、修补批次、师傅登记和换手记录。

## 文件结构

- `server.js` — 请求路由：HTTP 分发、请求体解析、统一响应
- `service.js` — 业务判定：师傅登记、批次换手校验（类型/时长/归属）、结项承办人复核
- `store.js` — 记录读写：`db.json` 读写、初始数据与旧数据迁移（重启后记录仍在）

## 启动

```bash
PORT=3020 node server.js
```

## 主要接口

- `GET /health`
- `GET /rubbings`
- `POST /rubbings`
- `GET /rubbings/:id/damages`
- `POST /rubbings/:id/damages`
- `GET /damages?status=&type=`
- `PATCH /damages/:id`
- `GET /workers`
- `POST /workers`
- `GET /batches`
- `POST /batches`
- `GET /batches/:id`
- `POST /batches/:id/complete`
- `POST /batches/:id/handover`
- `GET /batches/:id/handovers`
- `GET /handovers?batchId=`

## 批次换手流程

1. 师傅登记：能处理的缺损类型 + 当日剩余时长（分钟）。

   ```bash
   curl -X POST http://127.0.0.1:3020/workers \
     -H 'Content-Type: application/json' \
     -d '{"name":"王师傅","types":["虫蛀孔","撕裂"],"remainingMinutes":120}'
   ```

2. 开批时可指定承办人：`POST /batches` 携带 `handlerId`（可选，原有用法不变）。

3. 师傅临时离岗时发起换手，逐项填写目标缺损、原因、时刻、接手人和所需时长：

   ```bash
   curl -X POST http://127.0.0.1:3020/batches/<batchId>/handover \
     -H 'Content-Type: application/json' \
     -d '{
       "fromWorkerId": "<原师傅Id>",
       "toWorkerId": "<接手人Id>",
       "items": [
         {"damageId":"damage_demo_1","reason":"临时离岗","time":"2026-09-27T10:30:00.000Z","minutes":40}
       ]
     }'
   ```

   - 接手人类型不符或当日剩余时长不足 → 拒绝本次交接，原批次、工时和进度不变。
   - 接手成功 → 仅目标缺损退回 `pending`，已完成的缺损材料保留；批次承办人变更为接手人，接手人剩余时长相应扣减。

4. 结项复核：批次有承办人后，`POST /batches/:id/complete` 需携带当前承办人的 `workerId`，原师傅不能再提交；结项时按实际承办人记录 `completedBy`。

5. 每次换手可查：`GET /batches/:id/handovers` 返回前后承办人、逐项原因与时刻，记录持久化，重启仍在。

## 闭环示例

```bash
curl http://127.0.0.1:3020/damages?status=pending
curl -X POST http://127.0.0.1:3020/batches \
  -H 'Content-Type: application/json' \
  -d '{"name":"六月小批修补","damageIds":["damage_demo_1","damage_demo_2"]}'
```
