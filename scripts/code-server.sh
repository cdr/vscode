#!/usr/bin/env bash

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
fi

function code() {
	cd $ROOT

	# # Sync built-in extensions
	# yarn download-builtin-extensions

	# NOTE@coder: Never load the remote node
	# This leads to Node discrepencies between
	# local and remote and causes issues.
	# NODE=$(node build/lib/node.js)
	# if [ ! -e $NODE ];then
		# Load remote node
		# yarn gulp node
	# fi

	NODE_ENV=development \
	VSCODE_DEV=1 \
	$NODE ./scripts/code-server.js "$@"
}

code "$@"
