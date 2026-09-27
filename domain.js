const { makeId } = require("./store");

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function required(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === "");
  if (missing.length) fail(400, `缺少字段：${missing.join(", ")}`);
}

function todayStr() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function findRubbing(db, rubbingId) {
  const rubbing = db.rubbings.find((item) => item.id === rubbingId);
  if (!rubbing) fail(404, "拓片不存在");
  return rubbing;
}

function findBatch(db, batchId) {
  const batch = db.batches.find((item) => item.id === batchId);
  if (!batch) fail(404, "修补批次不存在");
  return batch;
}

function enrichBatch(db, batch) {
  const damages = db.damages.filter((item) => batch.damageIds.includes(item.id));
  return {
    ...batch,
    damages,
    total: damages.length,
    repaired: damages.filter((item) => item.status === "repaired").length,
    pending: damages.filter((item) => item.status !== "repaired").length,
    handoverCount: db.handovers.filter((item) => item.batchId === batch.id).length
  };
}

// ---------- 拓片与缺损 ----------

function listRubbings(db) {
  return db.rubbings.map((rubbing) => {
    const damages = db.damages.filter((item) => item.rubbingId === rubbing.id);
    return {
      ...rubbing,
      damageCount: damages.length,
      pendingDamages: damages.filter((item) => item.status !== "repaired").length
    };
  });
}

function createRubbing(db, body) {
  required(body, ["code", "source", "paperSize"]);
  const rubbing = {
    id: makeId("rubbing"),
    code: body.code,
    source: body.source,
    paperSize: body.paperSize,
    note: body.note || "",
    createdAt: new Date().toISOString()
  };
  db.rubbings.push(rubbing);
  return rubbing;
}

function listDamages(db, rubbingId) {
  findRubbing(db, rubbingId);
  return db.damages.filter((item) => item.rubbingId === rubbingId);
}

function createDamage(db, rubbingId, body) {
  findRubbing(db, rubbingId);
  required(body, ["position", "type", "beforePhotoUrl"]);
  const damage = {
    id: makeId("damage"),
    rubbingId,
    position: body.position,
    type: body.type,
    beforePhotoUrl: body.beforePhotoUrl,
    afterPhotoUrl: "",
    status: "pending",
    repairNote: "",
    batchId: null,
    assignee: null,
    createdAt: new Date().toISOString(),
    repairedAt: null
  };
  db.damages.push(damage);
  return damage;
}

function queryDamages(db, query) {
  return db.damages.filter(
    (item) => (!query.status || item.status === query.status) && (!query.type || item.type === query.type)
  );
}

function patchDamage(db, damageId, body) {
  const damage = db.damages.find((item) => item.id === damageId);
  if (!damage) fail(404, "缺损项不存在");
  Object.assign(damage, {
    position: body.position ?? damage.position,
    type: body.type ?? damage.type,
    beforePhotoUrl: body.beforePhotoUrl ?? damage.beforePhotoUrl,
    afterPhotoUrl: body.afterPhotoUrl ?? damage.afterPhotoUrl,
    status: body.status ?? damage.status,
    repairNote: body.repairNote ?? damage.repairNote
  });
  damage.repairedAt = damage.status === "repaired" ? new Date().toISOString() : damage.repairedAt;
  return damage;
}

// ---------- 师傅登记 ----------

function listWorkers(db) {
  return db.workers;
}

// 师傅当日登记：能处理的缺损类型 + 当日剩余时长（分钟），同日重复登记视为更新
function registerWorker(db, body) {
  required(body, ["name", "skillTypes", "remainingMinutes"]);
  if (!Array.isArray(body.skillTypes) || body.skillTypes.length === 0) fail(400, "skillTypes必须是非空数组");
  const remainingMinutes = Number(body.remainingMinutes);
  if (!Number.isFinite(remainingMinutes) || remainingMinutes < 0) fail(400, "remainingMinutes必须是非负分钟数");
  const today = todayStr();
  const now = new Date().toISOString();
  let worker = db.workers.find((item) => item.name === body.name && item.date === today);
  if (worker) {
    worker.skillTypes = body.skillTypes;
    worker.remainingMinutes = remainingMinutes;
    worker.updatedAt = now;
  } else {
    worker = {
      id: makeId("worker"),
      name: body.name,
      skillTypes: body.skillTypes,
      remainingMinutes,
      date: today,
      createdAt: now,
      updatedAt: now
    };
    db.workers.push(worker);
  }
  return worker;
}

function findWorkerForToday(db, name) {
  return db.workers.find((item) => item.name === name && item.date === todayStr());
}

// ---------- 批次 ----------

function listBatches(db) {
  return db.batches.map((batch) => enrichBatch(db, batch));
}

function createBatch(db, body) {
  required(body, ["name", "damageIds"]);
  if (!Array.isArray(body.damageIds) || body.damageIds.length === 0) fail(400, "damageIds必须是非空数组");
  const invalid = body.damageIds.filter((id) => !db.damages.find((damage) => damage.id === id));
  if (invalid.length) fail(400, `缺损项不存在：${invalid.join(", ")}`);
  const batch = {
    id: makeId("batch"),
    name: body.name,
    status: "open",
    assignee: body.assignee || null,
    damageIds: body.damageIds,
    note: body.note || "",
    createdAt: new Date().toISOString(),
    completedAt: null,
    closedBy: null,
    reviewedBy: null,
    reviewedAt: null
  };
  db.batches.push(batch);
  db.damages.forEach((damage) => {
    if (body.damageIds.includes(damage.id)) {
      damage.batchId = batch.id;
      damage.status = "in_repair";
      damage.assignee = batch.assignee;
    }
  });
  return enrichBatch(db, batch);
}

function getBatch(db, batchId) {
  return enrichBatch(db, findBatch(db, batchId));
}

function completeBatch(db, batchId, body) {
  const batch = findBatch(db, batchId);
  if (batch.status === "completed") fail(409, "批次已结项");
  const damages = db.damages.filter((damage) => batch.damageIds.includes(damage.id));
  // 批次有承办人时以批次承办人为准；多人分项接手（批次无单一承办人）时以各缺损项承办人为准
  const allowed = new Set();
  if (batch.assignee) {
    allowed.add(batch.assignee);
  } else {
    damages.forEach((damage) => {
      if (damage.assignee) allowed.add(damage.assignee);
    });
  }
  let closedBy = batch.assignee || null;
  if (allowed.size > 0) {
    // 有承办人的批次：只能由当前承办人提交，经复核人复核后按实际承办人结项
    required(body, ["worker", "reviewer"]);
    if (!allowed.has(body.worker)) fail(403, `「${body.worker}」不是当前承办人，不能提交结项`);
    closedBy = body.worker;
  }
  const results = Array.isArray(body.results) ? body.results : [];
  const now = new Date().toISOString();
  batch.status = "completed";
  batch.completedAt = now;
  batch.note = body.note ?? batch.note;
  batch.closedBy = closedBy;
  batch.reviewedBy = body.reviewer || null;
  batch.reviewedAt = body.reviewer ? now : null;
  damages.forEach((damage) => {
    const result = results.find((item) => item.damageId === damage.id) || {};
    damage.status = "repaired";
    damage.afterPhotoUrl = result.afterPhotoUrl || body.defaultAfterPhotoUrl || damage.afterPhotoUrl;
    damage.repairNote = result.repairNote || body.defaultRepairNote || damage.repairNote;
    damage.repairedAt = now;
  });
  return enrichBatch(db, batch);
}

// 批次换手：逐项登记接手人、原因、时刻和工时。
// 先整体校验再落地——类型不符或时长不足则整单拒绝，原批次、工时和进度不变。
function handoverBatch(db, batchId, body) {
  const batch = findBatch(db, batchId);
  if (batch.status !== "open") fail(409, "批次已结项，不能换手");
  required(body, ["fromWorker", "items"]);
  if (!Array.isArray(body.items) || body.items.length === 0) fail(400, "items必须是非空数组");
  if (batch.assignee && batch.assignee !== body.fromWorker) {
    fail(403, `当前承办人是「${batch.assignee}」，「${body.fromWorker}」不能发起换手`);
  }
  body.items.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(400, `第${index + 1}项交接内容格式不正确`);
  });
  const damageIds = body.items.map((item) => item.damageId);
  if (new Set(damageIds).size !== damageIds.length) fail(400, "交接清单中存在重复的缺损项");

  // 逐项校验
  const plans = body.items.map((item, index) => {
    required(item, ["damageId", "toWorker", "reason", "at", "minutes"]);
    const damage = db.damages.find((entry) => entry.id === item.damageId);
    if (!damage || !batch.damageIds.includes(damage.id)) fail(404, `缺损项不在本批次：${item.damageId}`);
    if (item.toWorker === body.fromWorker) fail(400, `第${index + 1}项接手人不能与原承办人相同`);
    const minutes = Number(item.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) fail(400, `第${index + 1}项工时必须是正数分钟`);
    const at = new Date(item.at);
    if (Number.isNaN(at.getTime())) fail(400, `第${index + 1}项时刻格式不正确`);
    const worker = findWorkerForToday(db, item.toWorker);
    if (!worker) fail(409, `接手人「${item.toWorker}」当日未登记可处理类型与剩余时长`);
    if (!worker.skillTypes.includes(damage.type)) fail(409, `类型不符：「${item.toWorker}」不能处理「${damage.type}」`);
    return { damage, worker, reason: item.reason, at: at.toISOString(), minutes };
  });

  // 按接手人汇总本次交接所需工时，与当日剩余时长比较
  const minutesNeeded = new Map();
  plans.forEach((plan) => {
    minutesNeeded.set(plan.worker, (minutesNeeded.get(plan.worker) || 0) + plan.minutes);
  });
  for (const [worker, needed] of minutesNeeded) {
    if (worker.remainingMinutes < needed) {
      fail(409, `时长不足：「${worker.name}」当日剩余${worker.remainingMinutes}分钟，本次交接需要${needed}分钟`);
    }
  }

  // 校验全部通过，开始落地
  const now = new Date().toISOString();
  const records = plans.map((plan) => {
    // 只把目标缺损退回待处理；已修复的缺损保留已完成材料，仅更新承办人
    if (plan.damage.status !== "repaired") plan.damage.status = "pending";
    plan.damage.assignee = plan.worker.name;
    plan.worker.remainingMinutes -= plan.minutes;
    plan.worker.updatedAt = now;
    const record = {
      id: makeId("handover"),
      batchId: batch.id,
      damageId: plan.damage.id,
      fromWorker: body.fromWorker,
      toWorker: plan.worker.name,
      reason: plan.reason,
      at: plan.at,
      minutes: plan.minutes,
      createdAt: now
    };
    db.handovers.push(record);
    return record;
  });

  // 单一接手人时批次承办人随之变更；多人分项接手时以各缺损项的承办人为准
  const successors = [...new Set(plans.map((plan) => plan.worker.name))];
  batch.assignee = successors.length === 1 ? successors[0] : null;
  return { batch: enrichBatch(db, batch), handovers: records };
}

// 重启仍在：未修复的缺损退回待处理并清空承办人，已完成材料保留
function restartBatch(db, batchId, body) {
  const batch = findBatch(db, batchId);
  if (batch.status !== "open") fail(409, "批次已结项，不能重启");
  const now = new Date().toISOString();
  db.damages.forEach((damage) => {
    if (!batch.damageIds.includes(damage.id)) return;
    if (damage.status === "repaired") return;
    damage.status = "pending";
    damage.assignee = null;
  });
  batch.assignee = null;
  batch.restartedAt = now;
  batch.restartCount = (batch.restartCount || 0) + 1;
  batch.note = body.note ?? batch.note;
  return enrichBatch(db, batch);
}

function listHandovers(db, batchId) {
  findBatch(db, batchId);
  return db.handovers.filter((item) => item.batchId === batchId);
}

module.exports = {
  listRubbings,
  createRubbing,
  listDamages,
  createDamage,
  queryDamages,
  patchDamage,
  listWorkers,
  registerWorker,
  listBatches,
  createBatch,
  getBatch,
  completeBatch,
  handoverBatch,
  restartBatch,
  listHandovers
};
