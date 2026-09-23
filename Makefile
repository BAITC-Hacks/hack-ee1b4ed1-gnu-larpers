.PHONY: setup analyze start start-agent build check check-backend check-frontend

UV ?= uv
NPM ?= npm
UV_RUN = $(UV) run --project backend --frozen --no-sync

setup:
	$(UV) sync --project backend --locked --extra agent
	$(NPM) ci

analyze:
	$(UV_RUN) money-graph --data data --out out $(ARGS)

start:
	$(NPM) run dev

start-agent:
	$(NPM) run start:agent

build:
	$(NPM) run build

check:
	$(NPM) run check

check-backend:
	$(NPM) run check:python

check-frontend:
	$(NPM) run check --workspace frontend
