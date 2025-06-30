#!/bin/bash

set -e

cd lambdas

for dir in */ ; do
  dir=${dir%/}
  echo "📦 Zippage de $dir..."
  (cd "$dir" && zip -qr "../$dir.zip" .)
done

echo "✅ Toutes les lambdas ont été zippées."
