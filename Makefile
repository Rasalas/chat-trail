SHELL := /bin/sh

.PHONY: install build dev typecheck clean release-local release

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

release-local:
	sh scripts/release-local.sh

release:
	sh scripts/release.sh
