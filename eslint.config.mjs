import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
	baseDirectory: __dirname,
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all
});

export default [...compat.extends("eslint:recommended"), {
	plugins: {
		"@typescript-eslint": typescriptEslint,
	},

	languageOptions: {
		globals: {
			...globals.node,
			...globals.browser,
		},

		parser: tsParser,
	},

	rules: {
		"arrow-body-style": ["error", "as-needed"],
		"class-methods-use-this": 1,
		eqeqeq: ["error", "smart"],

		"dot-notation": ["error", {
			allowKeywords: true,
		}],

		"func-call-spacing": ["error", "never"],
		"func-names": ["error", "as-needed"],

		"prefer-arrow-callback": ["error", {
			allowNamedFunctions: true,
			allowUnboundThis: true,
		}],

		"func-style": ["error", "declaration", {
			allowArrowFunctions: true,
		}],

		indent: ["error", "tab", {
			SwitchCase: 1,
			VariableDeclarator: 1,
			MemberExpression: 1,

			FunctionDeclaration: {
				parameters: 1,
			},

			CallExpression: {
				arguments: 1,
			},

			ArrayExpression: 1,
			ObjectExpression: 1,
			ImportDeclaration: 1,
			flatTernaryExpressions: true,
			offsetTernaryExpressions: true,
			ignoreComments: false,
		}],

		"linebreak-style": ["error", "unix"],
		quotes: ["error", "double"],
		semi: ["error", "always"],
		curly: ["error", "multi-or-nest"],
		"no-case-declarations": "off",
	},
}];