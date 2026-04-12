#!/usr/bin/env node

/**
 * 新枝 → Get笔记 自动同步脚本 (优化版)
 * 
 * 改进：
 * 1. 只获取最近 24 小时内创建的笔记，而不是前 50 条
 * 2. 添加详细日志和错误处理
 * 3. 添加重试机制
 * 4. 添加健康检查
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const XINZHI_TOKEN = process.env.XINZHI_TOKEN;
const GETNOTE_API_KEY = process.env.GETNOTE_API_KEY;
const GETNOTE_CLIENT_ID = process.env.GETNOTE_CLIENT_ID || 'cli_3802f9db08b811f197679c63c078bacc';
const PROCESSED_IDS_FILE = path.join(__dirname, 'processed_ids.json');

// 时间配置：只获取最近 24 小时的笔记
const LOOKBACK_HOURS = 24;
const LOOKBACK_MS = LOOKBACK_HOURS * 60 * 60 * 1000;

// ============ 辅助函数 ============

function httpRequest(options, body = null, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (retriesLeft) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch {
            resolve(data);
          }
        });
      });
      
      req.on('error', (err) => {
        if (retriesLeft > 0) {
          console.log(`   ⚠️ 请求失败，${retriesLeft} 秒后重试...`);
          setTimeout(() => attempt(retriesLeft - 1), 1000);
        } else {
          reject(err);
        }
      });
      
      req.on('timeout', () => {
        req.destroy();
        if (retriesLeft > 0) {
          console.log(`   ⏰ 请求超时，${retriesLeft} 秒后重试...`);
          setTimeout(() => attempt(retriesLeft - 1), 1000);
        } else {
          reject(new Error('请求超时'));
        }
      });
      
      req.setTimeout(15000);
      if (body) req.write(JSON.stringify(body));
      req.end();
    };
    
    attempt(retries);
  });
}

function loadProcessedIds() {
  try {
    if (fs.existsSync(PROCESSED_IDS_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, 'utf8')));
    }
  } catch (e) {
    console.log('   首次运行，创建新的处理记录...');
  }
  return new Set();
}

function saveProcessedIds(ids) {
  fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify([...ids], null, 2));
}

// ============ 新枝 API ============

async function fetchXinzhiNotes(pageIndex = 1, pageSize = 100) {
  const options = {
    hostname: 'api.xinzhi.zone',
    path: `/api/cli/note/list?pageIndex=${pageIndex}&pageSize=${pageSize}`,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-CLI-Token': XINZHI_TOKEN,
      'x-client': 'CLI',
      'x-request-source': 'xinzhi-cli'
    }
  };
  return httpRequest(options);
}

async function deleteXinzhiNote(noteId) {
  const options = {
    hostname: 'api.xinzhi.zone',
    path: `/api/cli/note/archive?id=${noteId}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CLI-Token': XINZHI_TOKEN,
      'x-client': 'CLI',
      'x-request-source': 'xinzhi-cli'
    }
  };
  return httpRequest(options);
}

// ============ Get笔记 API ============

async function saveToGetnote(linkUrl) {
  const options = {
    hostname: 'openapi.biji.com',
    path: '/open/api/v1/resource/note/save',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GETNOTE_API_KEY}`,
      'x-client-id': GETNOTE_CLIENT_ID,
      'Content-Type': 'application/json'
    }
  };
  return httpRequest(options, {
    title: '从小红书同步',
    link_url: linkUrl,
    note_type: 'link'
  });
}

async function pollTaskProgress(taskId, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const options = {
      hostname: 'openapi.biji.com',
      path: '/open/api/v1/resource/note/task/progress',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GETNOTE_API_KEY}`,
        'x-client-id': GETNOTE_CLIENT_ID,
        'Content-Type': 'application/json'
      }
    };
    try {
      const result = await httpRequest(options, { task_id: taskId });
      if (result.success && result.data) {
        if (result.data.status === 'success') return result.data;
        if (result.data.status === 'failed') return { status: 'failed', error: result.data.error_msg };
      }
    } catch (e) {
      console.log(`   ⚠️ 查询进度失败: ${e.message}`);
    }
  }
  return { status: 'timeout' };
}

// ============ 主流程 ============

async function main() {
  const startTime = Date.now();
  console.log('🚀 开始检查新枝笔记...');
  console.log('='.repeat(60));
  
  // 检查环境变量
  if (!XINZHI_TOKEN) {
    console.error('❌ 错误: XINZHI_TOKEN 未设置');
    process.exit(1);
  }
  if (!GETNOTE_API_KEY) {
    console.error('❌ 错误: GETNOTE_API_KEY 未设置');
    process.exit(1);
  }
  
  const processedIds = loadProcessedIds();
  const cutoffTime = Date.now() - LOOKBACK_MS;
  const cutoffDate = new Date(cutoffTime).toISOString();
  
  console.log(`📋 已处理的笔记数: ${processedIds.size}`);
  console.log(`📅 只检查最近 ${LOOKBACK_HOURS} 小时内创建的笔记 (${cutoffDate} 之后)`);
  console.log('');
  
  // 分页获取笔记
  let allNotes = [];
  let pageIndex = 1;
  let hasMore = true;
  let reachedCutoff = false;
  
  console.log('📡 正在获取新枝笔记...');
  
  while (hasMore && !reachedCutoff) {
    try {
      const response = await fetchXinzhiNotes(pageIndex);
      
      if (!response || !response.data || !response.data.list) {
        console.log('❌ 获取笔记失败:', JSON.stringify(response).substring(0, 200));
        break;
      }
      
      const notes = response.data.list;
      hasMore = response.data.has_more;
      
      // 过滤出最近 LOOKBACK_HOURS 小时内创建的笔记
      for (const note of notes) {
        const noteTime = note.createTime || note.editTime || 0;
        if (noteTime >= cutoffTime) {
          allNotes.push(note);
        } else {
          // 已经到了时间范围之外，停止获取
          reachedCutoff = true;
          break;
        }
      }
      
      console.log(`   第 ${pageIndex} 页: 获取 ${notes.length} 条，${hasMore ? '还有更多' : '已到末尾'}`);
      pageIndex++;
      
      // 安全限制，防止无限循环
      if (pageIndex > 100) {
        console.log('⚠️ 已达到最大页数限制');
        break;
      }
      
      // 短暂延迟避免限流
      await new Promise(r => setTimeout(r, 500));
      
    } catch (error) {
      console.log(`❌ 获取第 ${pageIndex} 页失败: ${error.message}`);
      break;
    }
  }
  
  console.log(`\n📦 共获取 ${allNotes.length} 条最近 ${LOOKBACK_HOURS} 小时内的笔记`);
  
  if (allNotes.length === 0) {
    console.log('✨ 没有最近创建的笔记');
    return;
  }
  
  // 筛选小红书链接
  const xiaohongshuNotes = allNotes.filter(note => {
    if (!note.link) return false;
    return note.link.includes('xiaohongshu.com') || note.link.includes('xhslink.com');
  });
  
  console.log(`🔴 其中 ${xiaohongshuNotes.length} 条是小红书链接`);
  
  // 过滤出未处理的笔记
  const newNotes = xiaohongshuNotes.filter(note => !processedIds.has(note.id));
  
  if (newNotes.length === 0) {
    console.log('✨ 没有新的小红书链接需要处理');
    console.log('   已有的小红书链接:');
    xiaohongshuNotes.slice(0, 5).forEach(note => {
      const status = processedIds.has(note.id) ? '✅ 已处理' : '❓ 未知';
      const time = new Date(note.createTime || note.editTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      console.log(`   - ${note.title || '无标题'} [${status}] @ ${time}`);
    });
    return;
  }
  
  console.log(`\n🔴 发现 ${newNotes.length} 条新的小红书链接！`);
  console.log('-'.repeat(60));
  
  let successCount = 0;
  let failCount = 0;
  
  for (const note of newNotes) {
    const noteTime = new Date(note.createTime || note.editTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    console.log(`\n📝 处理: ${note.title || note.link}`);
    console.log(`   🕐 创建时间: ${noteTime}`);
    console.log(`   🔗 链接: ${note.link}`);
    
    try {
      // 1. 保存到 Get笔记
      console.log('   ⏳ 保存到 Get笔记...');
      const saveResult = await saveToGetnote(note.link);
      
      if (saveResult.success && saveResult.data && saveResult.data.tasks) {
        const taskId = saveResult.data.tasks[0].task_id;
        console.log(`   📤 任务已创建: ${taskId}`);
        console.log('   ⏳ 等待内容抓取和解析...');
        
        const progress = await pollTaskProgress(taskId);
        
        if (progress.status === 'success') {
          console.log('   ✅ Get笔记保存成功!');
          successCount++;
        } else if (progress.status === 'failed') {
          console.log(`   ⚠️ Get笔记解析失败: ${progress.error}`);
          failCount++;
        } else {
          console.log('   ⚠️ Get笔记处理超时，但继续删除新枝记录');
          failCount++;
        }
      } else if (saveResult.code === 401 || saveResult.code === 403) {
        console.log('   ❌ Get笔记授权失败，请检查 API Key');
        failCount++;
      } else {
        console.log('   ⚠️ Get笔记保存结果异常:', JSON.stringify(saveResult).substring(0, 300));
        failCount++;
      }
      
      // 2. 归档新枝记录
      console.log('   🗑️ 归档新枝记录...');
      try {
        const deleteResult = await deleteXinzhiNote(note.id);
        if (deleteResult.success || deleteResult.code === 1001) {
          console.log('   ✅ 新枝记录已归档');
        } else {
          console.log('   ⚠️ 归档结果:', JSON.stringify(deleteResult).substring(0, 200));
        }
      } catch (e) {
        console.log(`   ⚠️ 归档失败: ${e.message}`);
      }
      
      // 无论 Get笔记是否成功，都标记为已处理（避免重复处理）
      processedIds.add(note.id);
      
    } catch (error) {
      console.log(`   ❌ 处理出错: ${error.message}`);
      failCount++;
    }
    
    console.log('   ⏳ 等待 2 秒避免限流...');
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // 保存已处理的 ID
  saveProcessedIds(processedIds);
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('\n' + '='.repeat(60));
  console.log('🎉 本次处理完成!');
  console.log(`📊 统计:`);
  console.log(`   - 新增处理: ${newNotes.length} 条`);
  console.log(`   - Get笔记成功: ${successCount} 条`);
  console.log(`   - 处理失败: ${failCount} 条`);
  console.log(`   - 累计已处理: ${processedIds.size} 条`);
  console.log(`   - 耗时: ${elapsed} 秒`);
}

// 错误处理
process.on('unhandledRejection', (error) => {
  console.error('❌ 未处理的错误:', error.message);
  process.exit(1);
});

main().catch((error) => {
  console.error('❌ 脚本执行失败:', error.message);
  process.exit(1);
});
