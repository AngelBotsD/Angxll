import speed from "performance-now";
import { exec } from "child_process";

let handler = async (m, { conn }) => {
  let timestamp = speed();

  exec(`neofetch --stdout`, (error, stdout, stderr) => {
    let latensi = speed() - timestamp;
    let child = stdout.toString("utf-8");
    let ssd = child.replace(/Memory:/, "Ram:");

    /*const buttons = [
      {
        buttonId: `.speed`, // el comando que se ejecutará al hacer clic
        buttonText: { displayText: "⚡ Ver velocidad" },
        type: 1
      }
    ];*/

    conn.sendMessage(m.chat, {
      text:`${ssd}\n乂 *Speed* : ${latensi.toFixed(4)} _ms_`,
      //footer: '📊 Información del sistema',
      //buttons: buttons,
      //headerType: 1
    }, { quoted: m });
  });
};

handler.command = ["ping", "p"];

export default handler;