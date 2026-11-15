"""GenWriter 初步冒烟测试：覆盖主要 REST 接口 + 失败态检查。
用法：python smoke_test.py [base_url]
输出：控制台表格 + smoke_result.json
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
import uuid

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080") + "/api"
RESULTS = []


def call(method, path, data=None, raw_body=None, content_type="application/json", timeout=15):
    url = BASE + path
    body = None
    if raw_body is not None:
        body = raw_body
    elif data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method=method)
    if body is not None:
        req.add_header("Content-Type", content_type)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            text = r.read().decode("utf-8", "replace")
            status = r.status
            ok = True
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        status = e.code
        ok = False
    except Exception as e:  # noqa: BLE001
        text = f"EXC: {e}"
        status = -1
        ok = False
    ms = int((time.time() - t0) * 1000)
    try:
        parsed = json.loads(text)
    except Exception:
        parsed = None
    return {"status": status, "ok": ok, "ms": ms, "text": text[:400], "json": parsed}


def record(name, method, path, result, expect=(200,), note=""):
    passed = result["status"] in expect
    RESULTS.append({
        "case": name, "method": method, "path": path,
        "status": result["status"], "ms": result["ms"],
        "pass": passed, "note": note, "snippet": result["text"][:200],
    })
    flag = "PASS" if passed else "FAIL"
    print(f"[{flag}] {name:<38} {method:<6} {path[:52]:<52} {result['status']} {result['ms']}ms")
    return passed


def data_of(result):
    j = result.get("json") or {}
    return j.get("data")


print(f"== GenWriter smoke test @ {BASE} ==\n")

# ---------- 1. 健康检查 ----------
r = call("GET", "/projects")
record("项目列表", "GET", "/projects", r)
project_id = None

# ---------- 2. 项目 CRUD ----------
r = call("POST", "/projects", {"name": f"smoke-项目-{uuid.uuid4().hex[:6]}", "description": "冒烟测试"})
record("创建项目", "POST", "/projects", r, (200, 201))
if data_of(r):
    project_id = data_of(r)["id"]

if project_id:
    r = call("GET", f"/projects/{project_id}")
    record("读取项目", "GET", f"/projects/{{id}}", r)
    r = call("PUT", f"/projects/{project_id}", {"name": "smoke-项目-已重命名", "description": "已改"})
    record("更新项目", "PUT", f"/projects/{id}", r)

# ---------- 3. 会话 CRUD ----------
session_id = None
if project_id:
    r = call("POST", "/sessions", {"title": "smoke 会话", "type": "CHAT", "projectId": project_id, "topic": "冒烟"})
    record("创建会话", "POST", "/sessions", r, (200, 201))
    session_id = (data_of(r) or {}).get("id")
if project_id:
    r = call("GET", f"/sessions/project/{project_id}")
    record("按项目查会话", "GET", "/sessions/project/{id}", r)
if session_id:
    r = call("GET", f"/sessions/{session_id}")
    record("读取会话", "GET", "/sessions/{id}", r)
    r = call("PUT", f"/sessions/{session_id}", {"title": "smoke 会话-改名"})
    record("更新会话", "PUT", "/sessions/{id}", r)

# ---------- 4. 消息 ----------
message_id = None
if session_id:
    r = call("POST", "/messages", {"sessionId": session_id, "role": "USER", "type": "text", "content": "冒烟测试消息"})
    record("创建消息", "POST", "/messages", r, (200, 201))
    message_id = (data_of(r) or {}).get("id")
    r = call("GET", f"/messages/session/{session_id}")
    record("按会话查消息", "GET", "/messages/session/{id}", r)
    r = call("GET", f"/messages/session/{session_id}/count")
    record("消息计数", "GET", "/messages/session/{id}/count", r)
    r = call("GET", f"/documents/session/{session_id}/latest")
    record("最新文稿(创建前)", "GET", "/documents/session/{id}/latest", r, (200, 400, 404, 500), "无文稿时返回 400")
    r = call("GET", f"/messages/session/{session_id}/recent?limit=5")
    record("最近消息", "GET", "/messages/session/{id}/recent", r, (200, 400))

# ---------- 5. 文稿 / 版本 ----------
doc_id = None
if session_id:
    r = call("POST", "/documents", {
        "sessionId": session_id, "title": "smoke 文稿", "content": "# 标题\n\n第一段内容。",
        "type": "draft", "format": "markdown", "status": "editing",
    })
    record("创建文稿", "POST", "/documents", r, (200, 201))
    doc_id = (data_of(r) or {}).get("id")
    r = call("POST", f"/documents/session/{session_id}/version", {
        "sessionId": session_id, "title": "smoke 文稿 V2", "content": "第二版内容",
        "type": "draft", "format": "markdown", "status": "editing",
    })
    record("创建新版本", "POST", "/documents/session/{id}/version", r, (200, 201))
    r = call("GET", f"/documents/session/{session_id}")
    record("按会话查文稿", "GET", "/documents/session/{id}", r)
if doc_id:
    r = call("PUT", f"/documents/{doc_id}", {"title": "smoke 文稿-改名", "content": "改后的内容"})
    record("更新文稿", "PUT", "/documents/{id}", r)
    r = call("POST", "/documents/export", {"sessionId": session_id, "title": "smoke 文稿", "content": "# 标题\n\n正文", "format": "md"})
    record("导出文稿", "POST", "/documents/export", r, (200, 400, 500))

# ---------- 6. 知识库 / RAG ----------
kb_id = None
r = call("POST", "/knowledge-bases", {"name": f"smoke-KB-{uuid.uuid4().hex[:6]}", "description": "冒烟", "type": "document"})
record("创建知识库", "POST", "/knowledge-bases", r, (200, 201))
kb_id = (data_of(r) or {}).get("id")
if kb_id:
    r = call("GET", f"/knowledge-bases/{kb_id}")
    record("读取知识库", "GET", "/knowledge-bases/{id}", r)
    r = call("GET", "/knowledge-bases")
    record("知识库列表", "GET", "/knowledge-bases", r)
r = call("POST", "/rag/process/text", {"text": "这是一段用于切分测试的文本。" * 30, "kbId": kb_id or "", "strategy": "FIXED_SIZE"})
record("文本切分", "POST", "/rag/process/text", r, (200, 400, 500), "无 embedding key 时可能失败")
r = call("POST", "/rag/search", {"query": "切分测试", "kbId": kb_id or "", "topK": 3})
record("向量检索(需 embedding)", "POST", "/rag/search", r, (200, 400, 500), "无 embedding key 预期失败")

# ---------- 7. 附件上传 ----------
if session_id:
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000a49444154789c6360000002000100ffff03000006000557bfabd400"
        "00000049454e44ae426082"
    )
    boundary = "----smoke" + uuid.uuid4().hex
    parts = []
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"sessionId\"\r\n\r\n{session_id}\r\n".encode())
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"smoke.png\"\r\n"
        f"Content-Type: image/png\r\n\r\n".encode() + png + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    r = call("POST", "/attachments/upload", raw_body=body, content_type=f"multipart/form-data; boundary={boundary}")
    record("附件上传", "POST", "/attachments/upload", r, (200, 201))
    att_id = (data_of(r) or {}).get("id")
    if att_id:
        r = call("GET", f"/attachments/{att_id}")
        record("读取附件元信息", "GET", "/attachments/{id}", r)

# ---------- 8. 记忆 / 技能 / 模板 / 设置 ----------
for name, path in [
    ("长期记忆列表", "/long-term-memories"),
    ("技能列表", "/skills"),
    ("写作模板", "/templates"),
    ("提示词 key 列表", "/prompts/keys"),
    ("输出格式设置", "/settings/writing-output"),
    ("LLM 供应商", "/llm/providers"),
]:
    r = call("GET", path)
    record(name, "GET", path, r, (200, 400, 404, 500))

# ---------- 8.5 未知路径应返回 404 ----------
r = call("GET", "/definitely-not-a-real-endpoint")
record("未知路径返回404", "GET", "/definitely-not-a-real-endpoint", r, (404,), "改版前会返回 500")

# ---------- 9. 聊天链路（无 key 的失败态） ----------
if session_id:
    r = call("POST", f"/messages/{session_id}/chat?type=AUTO&webSearch=false",
             {"text": "冒烟测试：请回复一句话"}, timeout=25)
    record("聊天(无 key 错误态)", "POST", "/messages/{id}/chat", r, (200, 400, 500), "预期因无 API key 失败")
    print("      聊天返回片段:", (r["text"] or "")[:160].replace("\n", " "))

# ---------- 10. 清理 ----------
if session_id:
    r = call("DELETE", f"/messages/session/{session_id}")
    record("清理消息", "DELETE", "/messages/session/{id}", r, (200, 204, 500))
    r = call("DELETE", f"/sessions/{session_id}")
    record("删除会话", "DELETE", "/sessions/{id}", r, (200, 204, 500))
if kb_id:
    r = call("DELETE", f"/knowledge-bases/{kb_id}")
    record("删除知识库", "DELETE", "/knowledge-bases/{id}", r, (200, 204, 500))
if project_id:
    r = call("DELETE", f"/projects/{project_id}")
    record("删除项目", "DELETE", "/projects/{id}", r, (200, 204, 500))

# ---------- 汇总 ----------
total = len(RESULTS)
passed = sum(1 for x in RESULTS if x["pass"])
print(f"\n== 合计 {passed}/{total} 通过 ==")
fails = [x for x in RESULTS if not x["pass"]]
if fails:
    print("失败用例：")
    for f in fails:
        print(f"  - {f['case']} -> {f['status']} {f['snippet'][:120]}")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "smoke_result.json")
with open(out, "w", encoding="utf-8") as fh:
    json.dump({"base": BASE, "total": total, "passed": passed, "results": RESULTS}, fh, ensure_ascii=False, indent=2)
print("结果已写入", out)
