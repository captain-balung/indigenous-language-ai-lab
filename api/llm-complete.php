<?php
/**
 * OpenAI Chat Completions proxy（PHP）。
 * POST JSON { system, user, model? } → { text }
 * 金鑰只從環境變數 OPENAI_API_KEY 讀取，禁止硬編碼。
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => '只接受 POST'], JSON_UNESCAPED_UNICODE);
  exit;
}

$apiKey = getenv('OPENAI_API_KEY');
if (!$apiKey) {
  http_response_code(503);
  echo json_encode(['error' => '未設定 OPENAI_API_KEY'], JSON_UNESCAPED_UNICODE);
  exit;
}

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
  http_response_code(400);
  echo json_encode(['error' => '請求必須是 JSON'], JSON_UNESCAPED_UNICODE);
  exit;
}

$system = isset($body['system']) && is_string($body['system']) ? trim($body['system']) : '';
$user = isset($body['user']) && is_string($body['user']) ? trim($body['user']) : '';
$model = isset($body['model']) && is_string($body['model']) && trim($body['model']) !== ''
  ? trim($body['model'])
  : 'gpt-4o-mini';
$maxChars = 8000;

if ($system === '' || $user === '') {
  http_response_code(400);
  echo json_encode(['error' => '需要 system 與 user 字串'], JSON_UNESCAPED_UNICODE);
  exit;
}
if (mb_strlen($system) > $maxChars || mb_strlen($user) > $maxChars) {
  http_response_code(400);
  echo json_encode(['error' => 'system／user 過長'], JSON_UNESCAPED_UNICODE);
  exit;
}

$payload = json_encode([
  'model' => $model,
  'temperature' => 0,
  'messages' => [
    ['role' => 'system', 'content' => $system],
    ['role' => 'user', 'content' => $user],
  ],
], JSON_UNESCAPED_UNICODE);

$ch = curl_init('https://api.openai.com/v1/chat/completions');
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ' . $apiKey,
    'Content-Type: application/json',
  ],
  CURLOPT_POSTFIELDS => $payload,
  CURLOPT_TIMEOUT => 30,
]);
$response = curl_exec($ch);
$errno = curl_errno($ch);
$error = curl_error($ch);
$status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($errno) {
  http_response_code(502);
  echo json_encode(['error' => $error ?: 'OpenAI 連線失敗'], JSON_UNESCAPED_UNICODE);
  exit;
}

$decoded = json_decode($response, true);
if ($status < 200 || $status >= 300) {
  $detail = is_array($decoded) && isset($decoded['error']['message'])
    ? $decoded['error']['message']
    : ('HTTP ' . $status);
  http_response_code(502);
  echo json_encode(['error' => 'OpenAI 請求失敗：' . $detail], JSON_UNESCAPED_UNICODE);
  exit;
}

$text = $decoded['choices'][0]['message']['content'] ?? null;
if (!is_string($text) || trim($text) === '') {
  http_response_code(502);
  echo json_encode(['error' => 'OpenAI 沒有回傳文字'], JSON_UNESCAPED_UNICODE);
  exit;
}

echo json_encode(['text' => trim($text), 'model' => $model], JSON_UNESCAPED_UNICODE);
