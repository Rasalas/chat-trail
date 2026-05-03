SHELL := /bin/sh

.PHONY: install build dev typecheck clean

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
