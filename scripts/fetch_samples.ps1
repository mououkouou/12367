# One-shot sample calls for the three ICN open APIs.
# The service key is read ONLY from the DATA_GO_KR_KEY environment variable and is never printed or saved.
$ErrorActionPreference = 'Stop'

$key = $env:DATA_GO_KR_KEY
if ([string]::IsNullOrEmpty($key)) { Write-Error 'DATA_GO_KR_KEY is not set.'; exit 1 }
# data.go.kr issues an "Encoding" and a "Decoding" key; only encode the decoded form.
$encKey = if ($key -match '%[0-9A-Fa-f]{2}') { $key } else { [Uri]::EscapeDataString($key) }

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'data\samples'
New-Item -ItemType Directory -Force $outDir | Out-Null
$today = Get-Date -Format 'yyyyMMdd'
$base = 'https://apis.data.go.kr/B551177'
$utf8 = New-Object Text.UTF8Encoding $false

$calls = @(
  @{ name = 'StatusOfPassengerFlightsDeOdp'
     path = 'StatusOfPassengerFlightsDeOdp/getPassengerDeparturesDeOdp'
     query = "type=json&searchday=$today&from_time=0000&to_time=2400&lang=K&numOfRows=20&pageNo=1" },
  @{ name = 'passgrAnncmt'
     path = 'passgrAnncmt/getPassgrAnncmt'
     query = 'type=json&selectdate=0&numOfRows=30&pageNo=1' },
  @{ name = 'StatusOfPassengerWorldWeatherInfo'
     path = 'StatusOfPassengerWorldWeatherInfo/getPassengerDeparturesWorldWeather'
     query = 'type=json&from_time=0000&to_time=2400&lang=K&numOfRows=10&pageNo=1' }
)

foreach ($c in $calls) {
  $url = "$base/$($c.path)?serviceKey=$encKey&$($c.query)"
  $wc = New-Object Net.WebClient
  $wc.Encoding = [Text.Encoding]::UTF8
  try {
    $body = $wc.DownloadString($url)
  } catch {
    $msg = $_.Exception.Message.Replace($encKey, '<key>').Replace($key, '<key>')
    "$($c.name): REQUEST FAILED - $msg"
    continue
  }
  $isJson = $body.TrimStart().StartsWith('{')
  $ext = if ($isJson) { 'json' } else { 'error.txt' }
  $file = Join-Path $outDir "$($c.name).$ext"
  [IO.File]::WriteAllText($file, $body.Replace($encKey, '<key>').Replace($key, '<key>'), $utf8)
  "$($c.name): saved $([IO.Path]::GetFileName($file)) ($($body.Length) chars)"
}
