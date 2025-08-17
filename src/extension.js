const vscode = require('vscode');

const cp = require('child_process');
const axios = require('axios');
// import axios from 'axios';
const util = require('util');

const SECRET_KEY_NAME = "wca-api-key"; // Replace with your actual key

async function promptForCommitType() {
    const types = [
        { label: 'feat', description: 'A new feature' },
        { label: 'fix', description: 'A bug fix' },
        { label: 'docs', description: 'Documentation only changes' },
        { label: 'style', description: 'Changes that do not affect meaning (white-space, formatting)' },
        { label: 'refactor', description: 'A code change that neither fixes a bug nor adds a feature' },
        { label: 'test', description: 'Adding or updating tests' },
        { label: 'chore', description: 'Other changes that don\'t modify src or test files' }
    ];

    const selected = await vscode.window.showQuickPick(types, {
        placeHolder: 'Select the type of change',
        ignoreFocusOut: true
    });

    return selected?.label || null;
}


async function getGitDiff() {
    return new Promise((resolve, reject) => {
        cp.exec('git diff --cached', { cwd: vscode.workspace.rootPath }, (err, stdout, stderr) => {
            if (err) {
                reject(stderr);
            } else {
                resolve(stdout);
            }
        });
    });
}

// function buildPrompt(diff) {
//   return `
// By analyazing the git difference, please generate a concise and simple git commit message in one-line.
// commit message should be in the format: "<type>: <commit message>.  Determine the intent of the change: choose from "feat", "fix", "refactor", "test", "docs", or "chore" and add it in the type in commit message."

// Git Diff:
// ${diff}
// `;
// }


function buildPrompt(diff, selectedType) {
    return `
By analyzing the following Git diff, generate a concise one-line Git commit message.

The message must follow this format:
"${selectedType}: <commit message>"

Only return the message, and ensure it reflects the selected type "${selectedType}".

Git Diff:
${diff}
`;
}


async function getIamToken(apiKey) {
  try{
  const response = await axios.post(
    'https://iam.cloud.ibm.com/identity/token',
    `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${apiKey}`,
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
    }
  );

  return response.data.access_token;
}catch(e){
  const status = e.response?.status;
  if(status===401 || status===403){
    await context.secrets.delete(SECRET_KEY_NAME);
    vscode.window.showErrorMessage("Invalid API Key. Please try Again..")
  }
  else{
    vscode.window.showErrorMessage("Error in Generating Commit message");
  }
  return null;
}
}

async function getOrPromptApiKey(context) {
    const storedKey = await context.secrets.get(SECRET_KEY_NAME);
    if (storedKey) {
        return storedKey;
    }

    const apiKey = await vscode.window.showInputBox({
        prompt: 'Enter your API Key for the Commit Message Generator',
        ignoreFocusOut: true,
        password: true
    });

    if (apiKey) {
        await context.secrets.store(SECRET_KEY_NAME, apiKey);
        return apiKey;
    } else {
        throw new Error('API key is required.');
    }
}

async function callWcaApi(token, prompt) {
  
  //setting the WCA req form
  const payload = {"message_payload": {
        "messages": [
          {
            "content": prompt,
            "role": "USER"
          }
        ]
      }
  };

const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
const form = new FormData();
form.append('message', base64Payload);

// WCA API Call
  const response = await axios.post(
    'https://api.dataplatform.cloud.ibm.com/v2/wca/core/chat/text/generation',
    form,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        // 'Request-ID': uuidv4(),  -- not required (required when chat with history)
        'content-type':'multipart/form-data'
      }
    }
  );

   const result = response.status==200 && response.data.response? response.data.response.message.content:'No response from WCA.';
  return result;
}

async function generateCommitMessage(apiKey,selectedType) {
  try {
    const diff = await getGitDiff();

    if (!diff) {
      vscode.window.showWarningMessage('No staged changes found. Stage changes before running this command.');
      return;
    }

    const prompt = buildPrompt(diff,selectedType);
    const token = await getIamToken(apiKey);
    const commitMessage = await callWcaApi(token, prompt);
     vscode.window.showInformationMessage(commitMessage.replaceAll('"', ''));
     if (commitMessage) {
                vscode.env.clipboard.writeText(commitMessage.replaceAll('"', ''));
                vscode.window.showInformationMessage('Generated commit message copied to clipboard!');
            }
  } catch (err) {
    vscode.window.showErrorMessage(`Error generating commit message: ${err.message || err}`);
  }
}

function activate(context) {
  let disposable = vscode.commands.registerCommand('wca.generateCommitMessage', async()=>{
    try{
        const apiKey = await getOrPromptApiKey(context);
        const selectedType = await promptForCommitType();
        if (!selectedType) {
            vscode.window.showWarningMessage('Commit type selection cancelled.');
            return;
        }
       await generateCommitMessage(apiKey,selectedType);

        
    }catch(e){
      vscode.window.showErrorMessage(`Error: ${e.message}`);
    }
  });
  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};