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
	rsvg-convert -w 128 -h 128 assets/icons/icon.svg -o public/icons/icon-128.png
	rsvg-convert -w 48 -h 48 assets/icons/icon.svg -o public/icons/icon-48.png
	rsvg-convert -w 32 -h 32 assets/icons/icon.svg -o public/icons/icon-32.png
	rsvg-convert -w 16 -h 16 assets/icons/icon.svg -o public/icons/icon-16.png

release-local:
	sh scripts/release-local.sh

release:
	sh scripts/release.sh
