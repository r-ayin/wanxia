# GPT Image 2 · 完整接入配置教程

> 基于深度智算 API 接入 OpenAI GPT Image 2 图片生成模型
> 最后更新：2026-06-18

---

## 一、基本信息

| 项目 | 内容 |
|------|------|
| 模型名 | `gpt-image-2` |
| 类型 | 图片生成模型（文生图 · 图生图） |
| 平台 | 深度智算（lingkeai） |
| BASE URL | `https://api.lk888.ai` |
| 本次测试密钥 | `sk-893...c662` |

---

## 二、鉴权方式

支持 4 种鉴权方式（任选一种即可）：

1. **推荐**：`Authorization: Bearer $API_KEY`
2. Anthropic 风格：`x-api-key: $API_KEY`
3. Gemini 风格：`x-goog-api-key: $API_KEY`
4. URL 参数：`?key=$API_KEY`

**实测结论：** 推荐方式 1（Bearer Token），POST 和 GET 都稳定可用。

---

## 三、可用接口

### 3.1 查看模型列表

```bash
curl -s -H "Authorization: Bearer $API_KEY" \
  "https://api.lk888.ai/v1/models"
```

返回包含 `gpt-5.5`、`deepseek-v4-pro`、`claude-fable-5`、`gpt-image-2`（媒体模型）等 **40 个模型**。

> 注意：`gpt-image-2` 不在 chat 模型列表里返回，它是媒体生成模型，通过独立的 `/v1/media/` 端点调用。

---

### 3.2 创建图片生成任务

**端点：** `POST https://api.lk888.ai/v1/media/generate`

**请求参数：**

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `model` | 是 | string | 固定 `gpt-image-2` |
| `prompt` | 是 | string | 图片描述，英文效果更佳 |
| `params.size` | 是 | enum | 图片尺寸，推荐 `auto` 自动决定 |
| `params.quality` | 否 | enum | 图片质量：`auto` / `high` / `medium` / `low` |
| `params.n` | 否 | int | 生成数量，默认 1 |
| `params.images` | 否 | array | 参考图片 URL（图生图），最多 10 张 |

**size 可选值：** `auto` / `1024x1024` / `1024x1536` / `1536x1024` / `960x1280` / `1280x960` / `1088x1920` / `1920x1088` / `2048x2048` / `2048x3072` / `3072x2048` / `1920x2560` / `2560x1920` / `1440x2560` / `2560x1440` / `2880x2880` / `2304x3456` / `3456x2304` / `2400x3200` / `3200x2400` / `2160x3840` / `3840x2160`

**quality 可选值：** `auto` / `high` / `medium` / `low`

**请求示例：**
```bash
curl -X POST "https://api.lk888.ai/v1/media/generate" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "params": {
      "size": "auto",
      "quality": "auto",
      "n": 1
    },
    "prompt": "A cute orange cat wearing glasses reading a book by the window"
  }'
```

**响应示例：**
```json
{
  "code": 200,
  "data": {
    "task_id": 47437862,
    "任务ids": [47437862],
    "对话组ID": "group_9828292_...",
    "成功数量": 1
  },
  "msg": "Task created successfully"
}
```

---

### 3.3 查询任务状态

**端点：** `GET https://api.lk888.ai/v1/media/status?task_id={task_id}`

```bash
curl -s "https://api.lk888.ai/v1/media/status?task_id=47437862" \
  -H "Authorization: Bearer $API_KEY"
```

**进行中响应：**
```json
{
  "task_id": 47437862,
  "state": "running",
  "status": "处理中",
  "is_final": false,
  "progress": "45%",
  "result_url": "",
  "cost": 0
}
```

**完成响应：**
```json
{
  "task_id": 47437862,
  "state": "success",
  "status": "已完成",
  "is_final": true,
  "progress": "100%",
  "result_url": "https://cos.lingkeai.vip/uploads/2026.06/18/20260618113356_18ba0f7e16d8a73c1795.png",
  "result_type": "image",
  "cost": 0.0792
}
```

**判定规则（关键！）：**
- **终态判定：** `is_final === true`
- **成功/失败：** `state` 字段，固定 4 档：`pending` / `running` / `success` / `failed`
- **❌ 不要用** `status` / `status_group` 做业务判断——它们是中文展示字段
- `state === 'failed'` 时任务自动退款
- 建议每 **3~5 秒**轮询一次

---

## 四、完整调用流程

```
POST /v1/media/generate  →  拿到 task_id
         ↓
每隔 3-5 秒 GET /v1/media/status?task_id=xxx
         ↓
   is_final === true ?
      ├── state === 'success'  →  从 result_url 下载图片
      └── state === 'failed'   →  任务失败，系统自动退款
```

**Python 示例：**
```python
import urllib.request, json, time

KEY = "your-api-key"

# 1. 创建任务
req = urllib.request.Request("https://api.lk888.ai/v1/media/generate")
req.add_header("Authorization", f"Bearer {KEY}")
req.add_header("Content-Type", "application/json")
data = json.dumps({
    "model": "gpt-image-2",
    "params": {"size": "auto", "quality": "auto", "n": 1},
    "prompt": "your prompt here"
}).encode()
resp = urllib.request.urlopen(req, data)
result = json.loads(resp.read())
task_id = result["data"]["task_id"]
print(f"Task created: {task_id}")

# 2. 轮询结果
while True:
    time.sleep(5)
    req = urllib.request.Request(f"https://api.lk888.ai/v1/media/status?task_id={task_id}")
    req.add_header("Authorization", f"Bearer {KEY}")
    resp = urllib.request.urlopen(req)
    status = json.loads(resp.read())
    if status["is_final"]:
        if status["state"] == "success":
            print(f"Done! Download: {status['result_url']}")
        else:
            print(f"Failed: {status}")
        break
```

---

## 五、实测数据

| 指标 | 数值 |
|------|------|
| 任务创建 | ✅ 成功 |
| 任务状态查询 | ✅ 成功（Bearer Token） |
| 图片生成耗时 | ~1 分钟 |
| 单次费用 | 0.0792（单位未明确） |
| 生成图片格式 | PNG |
| 图片大小 | ~2.2 MB |

---

## 六、注意事项

1. **密钥权限：** 本次测试的 key 对 `generate` 和 `status` 端点均有权限。如果遇到 status 返回 401，检查 key 是否完整、有无过期
2. **重复查询：** status 查询偶尔会短时间内返回 401，等待几秒重试即可恢复（可能是临时限流）
3. **任务过期：** 创建后的任务建议及时轮询，长时间不查的任务可能会丢失
4. **图生图：** 通过 `params.images` 传入参考图片 URL（最多 10 张），可用于风格参考
5. **尺寸建议：** 第一次接入推荐用 `auto`，让模型自动选择最优尺寸

---

## 七、文件位置

- 本文档：`E:\GPT-Image-2-接入配置教程.md`
- 接入文档原文：`E:\SKILL.zip`（深度智算导出的完整文档）
- 测试图片：`/tmp/gpt-image-2-cat.png`

---

_由 Hermes Agent 实测整理_
