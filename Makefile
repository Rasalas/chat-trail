SHELL := /bin/sh

.PHONY: install build dev typecheck clean icons release-local release

install:
	npm install

build:
	npm run build

dev:
	npm run dev

typecheck:
	npm run typecheck

clean:
	rm -rf dist

icons:
	magick -background none assets/icons/icon.svg -resize 128x128 public/icons/icon-128.png
	magick -background none assets/icons/icon.svg -resize 48x48 public/icons/icon-48.png
	magick -background none assets/icons/icon.svg -resize 32x32 public/icons/icon-32.png
	magick -background none assets/icons/icon.svg -resize 16x16 public/icons/icon-16.png

release-local:
	sh scripts/release-local.sh

release:
	sh scripts/release.sh
