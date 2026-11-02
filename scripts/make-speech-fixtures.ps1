# Generates reproducible TTS speech fixtures (16 kHz, mono, 16-bit WAV) with the built-in Windows SAPI voice.
# Usage (PowerShell, from the project root):   powershell -ExecutionPolicy Bypass -File scripts\make-speech-fixtures.ps1
# Output: samples\diagnostics\*.wav + matching *.txt (expected text). Synthetic speech is cleaner than a real
# microphone, so also record the same sentences yourself and drop them in the same folder for a fair test.
Add-Type -AssemblyName System.Speech
$out = Join-Path (Get-Location) 'samples\diagnostics'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

function New-Fixture($name, $ssmlBody, $expected) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SetOutputToWaveFile((Join-Path $out "$name.wav"), $fmt)
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>$ssmlBody</speak>"
  $synth.SpeakSsml($ssml)
  $synth.Dispose()
  Set-Content -Path (Join-Path $out "$name.txt") -Value $expected -NoNewline
}

New-Fixture '01-langchain-know'    'I would like to know about LangChain.'                        'I would like to know about LangChain.'
New-Fixture '02-langchain-explain' 'Can you explain what LangChain is?'                           'Can you explain what LangChain is?'
New-Fixture '03-langchain-used'    'What is LangChain used for?'                                  'What is LangChain used for?'
New-Fixture '04-plain-english'     'The weather was lovely, so we walked to the market.'          'The weather was lovely, so we walked to the market.'
New-Fixture '05-link-chain'        'The bicycle needs a new link chain.'                          'The bicycle needs a new link chain.'
New-Fixture '07-short-then-silence' "Hello there.<break time='3500ms'/>"                          'Hello there.'
New-Fixture '08-long-with-pauses'  "First, I want to understand retrieval.<break time='900ms'/>Second, how do embeddings fit in?<break time='900ms'/>Finally, what is LangChain used for?" 'First, I want to understand retrieval. Second, how do embeddings fit in? Finally, what is LangChain used for?'
Write-Host "Wrote fixtures to $out. Now run: npm run diagnose:whisper -- --make-nonspeech"
