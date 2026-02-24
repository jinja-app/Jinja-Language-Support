// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as prettier from "prettier";
import { jinjaLanguages } from "./constants/languages.const";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("Jinja extension activated!");

  const jsonPath = path.join(context.extensionPath, "jinja_widgets.json");

  const raw = fs.readFileSync(jsonPath, "utf8");
  const items = JSON.parse(raw);

  const provider = vscode.languages.registerCompletionItemProvider(
    jinjaLanguages,
    {
      provideCompletionItems(document, position) {
        const fullTextBeforeCursor = document.getText(
          new vscode.Range(new vscode.Position(0, 0), position),
        );

        const lineText = document.lineAt(position).text;
        const textBeforeLine = lineText.substring(0, position.character);
        const textAfterLine = lineText.substring(position.character);

        const closingMap: Record<string, string> = {
          "{{": "}}",
          "{%": "%}",
          "{#": "#}",
        };

        const completions: vscode.CompletionItem[] = [];
        // Loop through all items and check if the trigger matches the text before the cursor
        for (const item of items) {
          const trigger = item.triggered_at;
          const triggerLength = trigger.length;

          if (
            position.character < triggerLength ||
            textBeforeLine.slice(position.character - triggerLength) !== trigger
          ) {
            continue;
          }

          const hasClosingPair = !!closingMap[trigger];

          //If no closing pair → must be inside {{ }}
          if (!hasClosingPair) {
            const lastOpen = fullTextBeforeCursor.lastIndexOf("{{");
            const lastClose = fullTextBeforeCursor.lastIndexOf("}}");

            if (lastOpen === -1 || lastClose > lastOpen) {
              continue;
            }
          }

          const completion = new vscode.CompletionItem(
            item.label,
            vscode.CompletionItemKind.Function,
          );

          const startPos = new vscode.Position(
            position.line,
            position.character - triggerLength,
          );

          let endPos = position;

          const expectedClosing = closingMap[trigger];

          // If paired trigger and closing exists remove it
          if (expectedClosing && textAfterLine.startsWith(expectedClosing)) {
            endPos = new vscode.Position(
              position.line,
              position.character + expectedClosing.length,
            );
          }

          completion.range = new vscode.Range(startPos, endPos);
          completion.insertText = item.replaced_on_click;

          completion.filterText = trigger;
          completion.sortText = "0";

          const markdown = new vscode.MarkdownString(item.description);
          markdown.supportHtml = true;
          markdown.isTrusted = true;

          completion.documentation = markdown;
          completion.detail = item.replaced_on_click;

          completions.push(completion);
        }

        return completions.length
          ? new vscode.CompletionList(completions, false)
          : undefined;
      },
    },
    "%", // generic trigger characters
    "{",
    "|",
    ".",
    "#",
  );

  context.subscriptions.push(provider);

  ////// FORMATTTERRRRRRRR

  const formatter = vscode.languages.registerDocumentFormattingEditProvider(
    jinjaLanguages,
    {
      async provideDocumentFormattingEdits(document) {
        const text = document.getText();

        try {
          const options =
            (await prettier.resolveConfig(document.fileName)) || {};

          // Step 1: detect JSON blocks
          const jsonBlocks: { start: number; end: number; content: string }[] =
            [];
          let stack: { char: string; pos: number }[] = [];

          for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === "{" || c === "[") stack.push({ char: c, pos: i });
            if (
              c === "}" &&
              stack.length &&
              stack[stack.length - 1].char === "{"
            ) {
              const start = stack.pop()!.pos;
              if (stack.length === 0)
                jsonBlocks.push({
                  start,
                  end: i + 1,
                  content: text.slice(start, i + 1),
                });
            }
            if (
              c === "]" &&
              stack.length &&
              stack[stack.length - 1].char === "["
            ) {
              const start = stack.pop()!.pos;
              if (stack.length === 0)
                jsonBlocks.push({
                  start,
                  end: i + 1,
                  content: text.slice(start, i + 1),
                });
            }
          }

          let tempText = text;
          const placeholders: string[] = [];

          // Step 2: Replace JSON blocks with placeholders
          for (let i = jsonBlocks.length - 1; i >= 0; i--) {
            const { start, end, content } = jsonBlocks[i];
            try {
              const parsed = JSON.parse(content);

              let prettyJson = JSON.stringify(parsed, null, 2);
              const placeholder = `___JSON_PLACEHOLDER_${i}___`;
              placeholders[i] = prettyJson; // ✅ only assign if JSON is valid
              tempText =
                tempText.slice(0, start) + placeholder + tempText.slice(end);
            } catch {
              // Not valid JSON → skip and do not create placeholder
            }
          }

          // Step 3: format the whole document as HTML (placeholders remain intact)
          let htmlFormatted = await prettier.format(tempText, {
            parser: "html",
            ...options,
          });

          // Step 4: replace placeholders with formatted JSON, indented to match surrounding HTML
          for (let i = 0; i < placeholders.length; i++) {
            const prettyJson = placeholders[i];
            if (!prettyJson) continue; // skip undefined

            const placeholder = `___JSON_PLACEHOLDER_${i}___`;

            // Determine surrounding indentation
            const match = htmlFormatted.match(
              new RegExp(`(^\\s*)${placeholder}`, "m"),
            );

            htmlFormatted = htmlFormatted.replace(placeholder, prettyJson);
          }

          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(text.length),
          );
          return [vscode.TextEdit.replace(fullRange, htmlFormatted)];
        } catch (err: any) {
          vscode.window.showErrorMessage(
            "Prettier formatting failed: " + err.message,
          );
          return [];
        }
      },
    },
  );

  context.subscriptions.push(formatter);

  // Command to format selected JSON
  const formatJsonSelectionCommand = vscode.commands.registerCommand(
    "jinja.formatJsonSelection",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.selection;
      const text = editor.document.getText(selection).trim();
      if (!text) {
        vscode.window.showErrorMessage("No text selected");
        return;
      }

      try {
        // Try to parse the selection as JSON
        const parsed = JSON.parse(text);

        const options =
          (await prettier.resolveConfig(editor.document.fileName)) || {};
        let prettyJson = JSON.stringify(parsed, null, 2);

        editor.edit((editBuilder) => {
          editBuilder.replace(selection, prettyJson.trim());
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(
          "JSON formatting failed: " + err.message,
        );
      }
    },
  );

  context.subscriptions.push(formatJsonSelectionCommand);

  // ---------------- COMMAND ----------------
  const formatCommand = vscode.commands.registerCommand(
    "jinja.formatDocument",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      await vscode.commands.executeCommand("editor.action.formatDocument");
    },
  );

  context.subscriptions.push(formatCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
