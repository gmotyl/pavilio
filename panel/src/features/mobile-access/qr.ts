import QRCode from "qrcode";

export async function renderQrSvg(data: string): Promise<string> {
  return QRCode.toString(data, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}
