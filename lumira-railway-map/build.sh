#!/usr/bin/env bash
# Packages each TCDD SDK component (com.tcdd.*) into a deployable Lumira Designer
# extension JAR (same layout as the SAP sample extensions).
#   usage: ./build.sh            -> builds all com.tcdd.* plugins
#          ./build.sh com.tcdd.crosstab   -> builds one
set -euo pipefail
cd "$(dirname "$0")"
OUT_DIR="dist"; mkdir -p "${OUT_DIR}"
VERSION="1.0.0.$(date +%Y%m%d%H%M)"

build_one() {
  local DIR="$1" JAR="${OUT_DIR}/$1_${VERSION}.jar"
  [ -d "${DIR}" ] || { echo "skip: ${DIR} yok"; return; }
  sed -i.bak -E "s/^Bundle-Version:.*/Bundle-Version: ${VERSION}/" "${DIR}/META-INF/MANIFEST.MF"
  rm -f "${DIR}/META-INF/MANIFEST.MF.bak"
  rm -f "${OUT_DIR}/$1_"*.jar
  ( cd "${DIR}" && zip -q -r -X "../${JAR}" META-INF plugin.xml contribution.xml contribution.ztl res -x '*.DS_Store' )
  echo "Built ${JAR}"
}

if [ "$#" -ge 1 ]; then build_one "$1"; else for d in com.tcdd.*; do [ -d "$d" ] && build_one "$d"; done; fi
ls -1 "${OUT_DIR}"/*.jar
