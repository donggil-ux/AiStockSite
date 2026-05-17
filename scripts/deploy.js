#!/usr/bin/env node
/**
 * StockAI 배포 스크립트
 * 사용법:
 *   npm run deploy "커밋 메시지"    → 메시지 직접 입력
 *   npm run deploy                   → 변경 파일 목록으로 자동 생성
 */

const { execSync } = require('child_process');

function run(cmd) {
  return execSync(cmd, { cwd: __dirname + '/..', encoding: 'utf8' }).trim();
}

// 변경된 파일 확인
const status = run('git status --porcelain');
if (!status) {
  console.log('✅ 변경사항 없음 — 이미 최신 상태입니다.');
  process.exit(0);
}

// 커밋 메시지: CLI 인자 또는 자동 생성
const arg = process.argv.slice(2).join(' ').trim();
let msg = arg;

if (!msg) {
  // 변경된 파일 이름으로 자동 메시지 생성
  const files = status
    .split('\n')
    .map(l => l.trim().replace(/^\S+\s+/, ''))
    .join(', ');
  msg = `update: ${files}`;
}

// 버전 태그 추가 (sw.js CACHE_NAME에서 읽기)
try {
  const swContent = require('fs').readFileSync(__dirname + '/../sw.js', 'utf8');
  const match = swContent.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
  if (match) msg += ` (${match[1]})`;
} catch (e) {}

console.log('📦 변경 파일:');
console.log(status);
console.log(`\n💬 커밋 메시지: ${msg}\n`);

try {
  run('git add -A');
  run(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
  console.log('✅ 커밋 완료');

  run('git push origin main');
  console.log('🚀 푸시 완료 — 배포 시작됩니다!');
} catch (e) {
  console.error('❌ 오류:', e.message);
  process.exit(1);
}
