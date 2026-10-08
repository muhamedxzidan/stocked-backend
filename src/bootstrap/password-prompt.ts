import { stdin, stdout } from 'node:process';

export async function passwordPrompt(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error('A local interactive terminal is required');
  stdout.write(label);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = '';
    function finish(error?: Error): void {
      stdin.off('data', onData);
      stdin.off('error', onError);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    }
    function onError(): void {
      finish(new Error('Password input failed'));
    }
    function onData(data: string): void {
      for (const character of data) {
        if (character === '\u0003' || character === '\u0004') {
          finish(new Error('Cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
          continue;
        }
        if (character >= ' ') value += character;
      }
    }
    stdin.on('data', onData);
    stdin.on('error', onError);
  });
}
