# 古籍拓片缺损修补API

纯后端零依赖Node服务，使用 `data/db.json` 持久化拓片、缺损项、修补批次、师傅登记与换手记录。

## 代码结构

- `server.js`：请求路由与HTTP入口
- `domain.js`：业务判定（师傅登记、开批、换手、结项、重启等规则）
- `store.js`：记录读写（`data/db.json` 的加载、旧数据补全与落盘）

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
- `POST /batches/:id/restart`

## 批次换手流程

1. **师傅登记**：`POST /workers`，登记当日能处理的缺损类型和剩余时长（分钟），同日重复登记视为更新：

   ```bash
   curl -X POST http://127.0.0.1:3020/workers \
     -H 'Content-Type: application/json' \
     -d '{"name":"李师傅","skillTypes":["虫蛀孔","撕裂"],"remainingMinutes":120}'
   ```

2. **开批**：`POST /batches` 可带 `assignee` 指定承办人（原有不带承办人的用法照常可用）。

3. **交接**：`POST /batches/:id/handover`，逐项填写接手人、原因、时刻和工时：

   ```bash
   curl -X POST http://127.0.0.1:3020/batches/<batchId>/handover \
     -H 'Content-Type: application/json' \
     -d '{"fromWorker":"王师傅","items":[{"damageId":"damage_demo_1","toWorker":"李师傅","reason":"临时离岗","at":"2026-09-27T10:30:00+08:00","minutes":40}]}'
   ```

   - 接手人当日未登记、缺损类型不符或当日剩余时长不足，整单拒绝，原批次、工时和进度不变。
   - 接手成功后：目标缺损退回 `pending`（已修复的缺损保留已完成材料，仅更新承办人），接手人当日剩余时长相应扣减，批次承办人变更为新师傅。

4. **结项**：`POST /batches/:id/complete`。有承办人的批次须由当前承办人提交（`worker`）并经复核人复核（`reviewer`），批次按实际承办人 `closedBy` 结项；原师傅换手后不再是承办人，提交会被拒绝（403）。

5. **查换手**：`GET /batches/:id/handovers`，每次换手的前后台承办人、原因、时刻和工时均可查。

6. **重启仍在**：`POST /batches/:id/restart`，未修复的缺损退回待处理并清空承办人，已完成材料保留。

## 闭环示例

```bash
curl http://127.0.0.1:3020/damages?status=pending
curl -X POST http://127.0.0.1:3020/batches \
  -H 'Content-Type: application/json' \
  -d '{"name":"六月小批修补","damageIds":["damage_demo_1","damage_demo_2"]}'
```
