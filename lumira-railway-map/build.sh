#!/usr/bin/env bash
# Packages the TCDD Railway Map SDK component into a deployable Lumira Designer
# extension JAR (same layout as the SAP sample extensions).
set -euo pipefail

PLUGIN_DIR="com.tcdd.railmap"
BSN="com.tcdd.railmap"
VERSION="1.0.0.$(date +%Y%m%d%H%M)"
OUT_DIR="dist"
JAR="${OUT_DIR}/${BSN}_${VERSION}.jar"

cd "$(dirname "$0")"
mkdir -p "${OUT_DIR}"

# stamp the manifest version
sed -i.bak -E "s/^Bundle-Version:.*/Bundle-Version: ${VERSION}/" "${PLUGIN_DIR}/META-INF/MANIFEST.MF"
rm -f "${PLUGIN_DIR}/META-INF/MANIFEST.MF.bak"

rm -f "${JAR}"
( cd "${PLUGIN_DIR}" && zip -q -r -X "../${JAR}" \
    META-INF plugin.xml contribution.xml contribution.ztl res \
    -x '*.DS_Store' )

echo "Built ${JAR}"
unzip -l "${JAR}"
