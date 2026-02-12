// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const jsonPath = path.join(context.extensionPath, "jinja_widgets.json");

  const raw = fs.readFileSync(jsonPath, "utf8");
  const items = JSON.parse(raw);

  const provider = vscode.languages.registerCompletionItemProvider(
    "jinja",
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
}

// This method is called when your extension is deactivated
export function deactivate() {}
