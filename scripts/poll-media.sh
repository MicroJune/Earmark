#!/bin/bash
# Decisive capture: is the media notification actually posted while playing?
PKG=com.daryl.postcastassistant
for i in $(seq 1 12); do
  ts=$(date +%H:%M:%S)
  stack=$(adb shell dumpsys media_session 2>/dev/null | grep 'Sessions Stack')
  playback=$(adb shell dumpsys media_session 2>/dev/null | grep -A2 'Audio playback' | grep -c "$PKG")
  echo "[$ts] $stack | app_in_playback_list=$playback"
  adb shell dumpsys notification 2>/dev/null | grep "NotificationRecord" | grep "$PKG" | sed 's/^/    REC: /'
  sleep 5
done
echo '=== final: full notification records for pkg ==='
adb shell dumpsys notification --noredact 2>/dev/null | grep -B1 -A20 "NotificationRecord.*$PKG" | head -60
