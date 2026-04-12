#!/usr/bin/env python3
"""
滴答清单 → 任务中心同步脚本
功能：将滴答清单的任务同步到 Notion 任务中心（保持时间一致）

流程：
1. 获取滴答指定日期的任务
2. 在任务中心搜索是否已存在（按标题匹配）
3. 如果不存在，创建新任务
4. 如果存在但时间不一致，更新时间
"""

import requests
import json
from datetime import datetime, timedelta
import os

# ============== 配置 ==============
NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")
DIDA_TOKEN = os.environ.get("DIDA_TOKEN", "")

if not NOTION_TOKEN or not DIDA_TOKEN:
    raise ValueError("请设置环境变量 NOTION_TOKEN 和 DIDA_TOKEN")

# Notion数据库ID
TASK_DB_ID = "18133b33-7f23-8032-8f8e-e9e7c821f021"   # 任务中心

# API配置
NOTION_VERSION = "2022-06-28"
NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
}
DIDA_HEADERS = {
    "Authorization": f"Bearer {DIDA_TOKEN}",
    "Content-Type": "application/json"
}
DIDA_BASE = "https://api.dida365.com"

# 滴答清单ID映射（名称 -> ID）
PROJECT_IDS = {
    "濠联": "5e4cfef0c7edd11da9d5d956",
    "产品AI": "6825ab4ef12d11b11d7a4438",
    "杂事": "6047b441e99211186ac946e9",
    "旅行": "6825aa6e4750d1b11d7a28a5",
    "学术": "6406ebd9ccacd1017417b974",
    "理财": "69870dfa2fae5176a082bb20",
    "shopee": "686e9aec5c5751e8c67cade5",
    "书籍": "5ff9ffd8fa6d5106156432a9",
    "工作": "6493430012fa510358848b31",
    "健康": "68027b74e3d0d1f4189d4578",
    "影剧": "5ff9fffdf313d106156432d5fc",
    "展览活动": "69a2c97dc101d162759eee4d",
    "自我管理": "65e40aed3e64110443527cf5",
    "购物": "6309c13dd063d1013009fb4e",
}


def normalize_dida_date(date_str: str) -> dict:
    """
    将滴答日期转换为 Notion 日期格式
    输入: "2026-04-16T16:00:00.000+0000"
    输出: {"start": "2026-04-16", "end": "2026-04-16"}
    """
    if not date_str:
        return None
    
    # 解析滴答日期
    dt = datetime.fromisoformat(date_str.replace('+0000', '+00:00'))
    date_part = dt.strftime("%Y-%m-%d")
    
    return {"start": date_part, "end": date_part}


def get_dida_tasks_for_date(target_date: str) -> list:
    """获取滴答清单指定日期的任务"""
    all_tasks = []
    
    # 获取收集箱
    inbox_url = f"{DIDA_BASE}/open/v1/project/inbox/data"
    response = requests.get(inbox_url, headers=DIDA_HEADERS)
    if response.status_code == 200:
        data = response.json()
        all_tasks.extend(data.get("tasks", []))
    
    # 获取所有清单
    for project_name, project_id in PROJECT_IDS.items():
        url = f"{DIDA_BASE}/open/v1/project/{project_id}/data"
        resp = requests.get(url, headers=DIDA_HEADERS)
        if resp.status_code == 200:
            data = resp.json()
            all_tasks.extend(data.get("tasks", []))
    
    # 去重
    seen_ids = set()
    unique_tasks = []
    for t in all_tasks:
        tid = t.get("id", "")
        if tid and tid not in seen_ids:
            seen_ids.add(tid)
            unique_tasks.append(t)
    
    # 匹配目标日期
    matched_tasks = []
    for task in unique_tasks:
        task_id = task.get("id", "")
        title = task.get("title", "")
        # 保留完整 ISO 格式用于后续处理
        due_date = task.get("dueDate", "") or ""
        start_date = task.get("startDate", "") or ""
        
        # 转换为日期部分
        due_date_day = due_date[:10] if due_date else ""
        start_date_day = start_date[:10] if start_date else ""
        
        is_match = False
        
        # 匹配条件
        if due_date_day == target_date or start_date_day == target_date:
            is_match = True
        elif start_date_day and due_date_day:
            try:
                start = datetime.strptime(start_date_day, "%Y-%m-%d")
                end = datetime.strptime(due_date_day, "%Y-%m-%d")
                target = datetime.strptime(target_date, "%Y-%m-%d")
                if start <= target <= end:
                    is_match = True
            except:
                pass
        
        if is_match and title.strip():
            matched_tasks.append({
                "dida_id": task_id,
                "title": title.strip(),
                "startDate": start_date,
                "dueDate": due_date,
                "priority": task.get("priority", 1),
                "status": task.get("status", 0)
            })
    
    return matched_tasks


def search_notion_task(query: str) -> list:
    """在任务中心搜索任务"""
    payload = {
        "filter": {"property": "名称", "rich_text": {"contains": query}},
        "page_size": 100
    }
    
    url = f"https://api.notion.com/v1/databases/{TASK_DB_ID}/query"
    response = requests.post(url, headers=NOTION_HEADERS, json=payload)
    
    if response.status_code != 200:
        print(f"搜索任务中心失败: {response.status_code}")
        return []
    
    data = response.json()
    tasks = []
    
    for page in data.get("results", []):
        props = page.get("properties", {})
        name_data = props.get("名称") or {}
        name_list = name_data.get("title") or []
        name = name_list[0].get("plain_text") if name_list else ""
        
        date_data = props.get("日期") or {}
        date_obj = date_data.get("date") or {}
        date_start = date_obj.get("start", "")[:10] if date_obj.get("start") else ""
        date_end = date_obj.get("end", "")[:10] if date_obj.get("end") else ""
        
        tasks.append({
            "id": page["id"],
            "title": name,
            "date_start": date_start,
            "date_end": date_end
        })
    
    return tasks


def create_notion_task(title: str, start_date: str = None, end_date: str = None) -> str:
    """在任务中心创建新任务"""
    url = "https://api.notion.com/v1/pages"
    
    date_obj = None
    if start_date and end_date:
        date_obj = {"start": start_date, "end": end_date}
    elif start_date:
        date_obj = {"start": start_date}
    elif end_date:
        date_obj = {"start": end_date, "end": end_date}
    
    payload = {
        "parent": {"database_id": TASK_DB_ID},
        "properties": {
            "名称": {
                "title": [{"text": {"content": title}}]
            }
        }
    }
    
    if date_obj:
        payload["properties"]["日期"] = {"date": date_obj}
    
    response = requests.post(url, headers=NOTION_HEADERS, json=payload)
    
    if response.status_code == 200:
        data = response.json()
        return data.get("id")
    else:
        print(f"创建任务失败: {response.status_code} - {response.text[:200]}")
        return None


def update_notion_task_date(page_id: str, start_date: str, end_date: str = None) -> bool:
    """更新任务的日期"""
    url = f"https://api.notion.com/v1/pages/{page_id}"
    
    date_obj = {"start": start_date}
    if end_date:
        date_obj["end"] = end_date
    
    payload = {
        "properties": {
            "日期": {"date": date_obj}
        }
    }
    
    response = requests.patch(url, headers=NOTION_HEADERS, json=payload)
    return response.status_code == 200


def sync_dida_to_notion(target_date: str, dry_run: bool = True) -> dict:
    """同步滴答任务到任务中心"""
    results = {
        "date": target_date,
        "dida_tasks": [],
        "created": [],
        "updated": [],
        "already_synced": [],
        "failed": []
    }
    
    print(f"\n{'='*60}")
    print(f"📅 日期: {target_date}")
    print(f"{'='*60}")
    
    # 1. 获取滴答任务
    print(f"\n📋 获取滴答任务...")
    dida_tasks = get_dida_tasks_for_date(target_date)
    results["dida_tasks"] = dida_tasks
    print(f"   找到 {len(dida_tasks)} 个任务")
    
    if not dida_tasks:
        return results
    
    # 2. 处理每个任务
    print(f"\n🔄 同步到任务中心...")
    for task in dida_tasks:
        title = task["title"]
        start_date = task.get("startDate", "")[:10] if task.get("startDate") else ""
        due_date = task.get("dueDate", "")[:10] if task.get("dueDate") else ""
        
        # 搜索任务中心
        matched = search_notion_task(title)
        
        if not matched:
            # 任务中心没有，创建新任务
            date_display = f"{start_date[:10]}~{due_date[:10]}" if (start_date and due_date and start_date[:10] != due_date[:10]) else (due_date[:10] or start_date[:10])
            if dry_run:
                print(f"   🔄 {title} [{date_display}]: 将创建")
                results["created"].append(title)
            else:
                new_id = create_notion_task(title, start_date[:10], due_date[:10])
                if new_id:
                    print(f"   ✅ {title}: 创建成功")
                    results["created"].append(title)
                else:
                    print(f"   ❌ {title}: 创建失败")
                    results["failed"].append(title)
        else:
            # 任务中心已存在，检查日期
            matched_task = matched[0]  # 取第一个匹配
            existing_start = matched_task["date_start"]
            existing_end = matched_task["date_end"]
            
            # 检查日期范围是否一致
            # 考虑：start_date, due_date 都可能为空
            dida_start = start_date[:10] if start_date else None
            dida_end = due_date[:10] if due_date else None
            
            is_same_date = (
                (dida_start == existing_start and dida_end == existing_end) or
                (dida_start == existing_start and not dida_end and not existing_end) or
                (dida_end == existing_start and not dida_start and not existing_end)
            )
            
            if is_same_date:
                date_display = f"{existing_start}~{existing_end}" if existing_end else existing_start
                print(f"   ✅ {title} [{date_display}]: 已同步")
                results["already_synced"].append(title)
            else:
                # 日期不一致，更新
                existing_display = f"{existing_start}~{existing_end}" if existing_end else existing_start
                new_display = f"{dida_start or ''}~{dida_end or ''}" if (dida_start and dida_end) else (dida_end or dida_start or dida_start)
                if dry_run:
                    print(f"   🔄 {title}: 日期从 {existing_display} 更新为 {new_display}")
                    results["updated"].append(title)
                else:
                    if update_notion_task_date(matched_task["id"], dida_end or dida_start, dida_start if dida_end else None):
                        print(f"   ✅ {title}: 日期更新为 {new_display}")
                        results["updated"].append(title)
                    else:
                        print(f"   ❌ {title}: 更新失败")
                        results["failed"].append(title)
    
    # 3. 汇总
    print(f"\n{'='*60}")
    print(f"📊 同步结果")
    print(f"{'='*60}")
    print(f"   滴答任务数: {len(dida_tasks)}")
    print(f"   新建: {len(results['created'])}")
    print(f"   更新: {len(results['updated'])}")
    print(f"   已同步: {len(results['already_synced'])}")
    print(f"   失败: {len(results['failed'])}")
    
    if dry_run:
        print(f"\n⚠️  当前是模拟运行，如需实际执行请设置 dry_run=False")
    
    return results


def main():
    """入口函数"""
    import sys
    
    # 默认处理今天
    today = datetime.now().strftime("%Y-%m-%d")
    
    date = today
    dry_run = True
    
    if len(sys.argv) > 1:
        date = sys.argv[1]
    if len(sys.argv) > 2:
        dry_run = sys.argv[2].lower() != "run"
    
    print(f"🤖 滴答任务 → 任务中心同步")
    print(f"   目标日期: {date}")
    print(f"   模式: {'模拟运行' if dry_run else '实际执行'}")
    
    sync_dida_to_notion(date, dry_run=dry_run)


if __name__ == "__main__":
    main()
