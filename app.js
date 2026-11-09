(() => {
  "use strict";

  const form = document.querySelector("#contractForm");
  const contractorInput = document.querySelector("#contractor");
  const cpfInput = document.querySelector("#cpf");
  const servicesInput = document.querySelector("#services");
  const addressInput = document.querySelector("#address");
  const totalInput = document.querySelector("#total");
  const eventDateInput = document.querySelector("#eventDate");
  const paymentMethodInput = document.querySelector("#paymentMethod");
  const installmentField = document.querySelector("#installmentField");
  const installmentCountInput = document.querySelector("#installmentCount");
  const downloadButton = document.querySelector("#downloadButton");
  const previewCanvas = document.querySelector("#pdfPreview");
  const previewContext = previewCanvas.getContext("2d");
  const previewOverlay = document.querySelector("#previewOverlay");
  const previewStatus = document.querySelector("#previewStatus");
  const formError = document.querySelector("#formError");
  const summaryTitle = document.querySelector("#summaryTitle");
  const summaryHint = document.querySelector("#summaryHint");
  const paymentBreakdown = document.querySelector("#paymentBreakdown");
  const paymentClause = document.querySelector("#paymentClause");

  const MAX_INSTALLMENTS = 120;
  let PDFDocument;
  let StandardFonts;
  let rgb;
  let pdfjsLib;
  let GOLD;
  let WHITE;
  const outputCurrency = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  let templateBytes;
  let debounceTimer;
  let renderSequence = 0;
  let activeRenderTask;

  function setStatus(message, state) {
    previewStatus.textContent = message;
    previewStatus.dataset.state = state || "normal";
  }

  function normalizeMoney(value) {
    const raw = value.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
    if (!raw) return null;

    let normalized;
    if (raw.includes(",")) {
      if (!/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$|^\d+(?:,\d{1,2})?$/.test(raw)) {
        return null;
      }
      normalized = raw.replace(/\./g, "").replace(",", ".");
    } else if (raw.includes(".")) {
      const lastDot = raw.lastIndexOf(".");
      const decimals = raw.length - lastDot - 1;
      if (decimals === 1 || decimals === 2) {
        if (!/^\d+(?:\.\d{1,2})$/.test(raw)) return null;
        normalized = raw;
      } else {
        if (!/^\d{1,3}(?:\.\d{3})+$/.test(raw)) return null;
        normalized = raw.replace(/\./g, "");
      }
    } else {
      if (!/^\d+$/.test(raw)) return null;
      normalized = raw;
    }

    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999) {
      return null;
    }
    return Math.round(amount * 100);
  }

  function groupToWords(value) {
    const units = [
      "zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
    ];
    const teens = [
      "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis",
      "dezessete", "dezoito", "dezenove",
    ];
    const tens = [
      "", "", "vinte", "trinta", "quarenta", "cinquenta",
      "sessenta", "setenta", "oitenta", "noventa",
    ];
    const hundreds = [
      "", "cento", "duzentos", "trezentos", "quatrocentos",
      "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos",
    ];
    if (value === 0) return "";
    if (value === 100) return "cem";

    const parts = [];
    const hundred = Math.floor(value / 100);
    const rest = value % 100;
    if (hundred) parts.push(hundreds[hundred]);
    if (rest >= 10 && rest <= 19) {
      parts.push(teens[rest - 10]);
    } else if (rest >= 20) {
      parts.push(tens[Math.floor(rest / 10)]);
      if (rest % 10) parts.push(units[rest % 10]);
    } else if (rest > 0) {
      parts.push(units[rest]);
    }
    return parts.join(" e ");
  }

  function integerToWords(value) {
    if (value === 0) return "zero";
    const groups = [
      { divisor: 1_000_000_000, singular: "bilhão", plural: "bilhões" },
      { divisor: 1_000_000, singular: "milhão", plural: "milhões" },
      { divisor: 1_000, singular: "mil", plural: "mil" },
      { divisor: 1, singular: "", plural: "" },
    ];
    let remainder = value;
    const parts = [];

    for (const group of groups) {
      const quantity = Math.floor(remainder / group.divisor);
      if (quantity === 0) continue;
      remainder %= group.divisor;

      let phrase;
      if (group.divisor === 1) {
        phrase = groupToWords(quantity);
      } else if (group.divisor === 1_000 && quantity === 1) {
        phrase = "mil";
      } else {
        const label = quantity === 1 ? group.singular : group.plural;
        phrase = `${groupToWords(quantity)} ${label}`;
      }
      parts.push({ phrase, quantity, divisor: group.divisor });
    }

    return parts
      .map((part, index) => {
        if (index === 0) return part.phrase;
        const useAnd = part.quantity < 100 || part.quantity % 100 === 0;
        return `${useAnd ? " e " : " "}${part.phrase}`;
      })
      .join("");
  }

  function moneyToWords(cents) {
    const reais = Math.floor(cents / 100);
    const centavos = cents % 100;
    const realWords = integerToWords(reais);
    let result = `${realWords} ${reais === 1 ? "real" : "reais"}`;
    if (centavos > 0) {
      result += ` e ${integerToWords(centavos)} ${
        centavos === 1 ? "centavo" : "centavos"
      }`;
    }
    return result;
  }

  function formatDate(dateValue) {
    if (!dateValue) return "";
    const [year, month, day] = dateValue.split("-").map(Number);
    if (!year || !month || !day) return "";
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }

  function formatPreviousDate(dateValue) {
    if (!dateValue) return "";
    const [year, month, day] = dateValue.split("-").map(Number);
    if (!year || !month || !day) return "";
    const previous = new Date(Date.UTC(year, month - 1, day - 1));
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(previous);
  }

  function getInstallments(totalCents, count) {
    const regularCents = Math.floor(totalCents / count);
    const remainder = totalCents % count;
    return Array.from({ length: count }, (_, index) =>
      regularCents + (index < remainder ? 1 : 0),
    );
  }

  function getFormData() {
    const serviceLines = servicesInput.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const totalCents = normalizeMoney(totalInput.value);
    const installmentCount = Number(installmentCountInput.value);
    const cpfDigits = cpfInput.value.replace(/\D/g, "");

    return {
      contractor: contractorInput.value.trim(),
      cpfDigits,
      services: serviceLines,
      address: addressInput.value.trim(),
      totalCents,
      eventDate: eventDateInput.value,
      paymentMethod: paymentMethodInput.value,
      installmentCount,
    };
  }

  function makePaymentText(data) {
    if (!data.totalCents) {
      return "Informe o valor total para calcular e inserir a forma de pagamento no contrato.";
    }

    const amount = outputCurrency.format(data.totalCents / 100);
    const amountWords = moneyToWords(data.totalCents);

    if (data.paymentMethod === "cash") {
      return `2.1 O CONTRATANTE pagará ao CONTRATADO o valor total de ${amount} (${amountWords}), à vista, com quitação integral do contrato.`;
    }

    if (data.paymentMethod === "reservation") {
      if (data.totalCents < 2) {
        return "2.1 O valor total precisa ser de pelo menos R$ 0,02 para dividir o pagamento em duas partes.";
      }
      const reservationCents = Math.ceil(data.totalCents / 2);
      const remainingCents = data.totalCents - reservationCents;
      const reservation = outputCurrency.format(reservationCents / 100);
      const remaining = outputCurrency.format(remainingCents / 100);
      const roundingNote =
        data.totalCents % 2 === 0
          ? ""
          : ` (ajuste de ${outputCurrency.format(0.01)} por arredondamento para centavos)`;
      const dueDate = formatPreviousDate(data.eventDate);
      const dueDateText = dueDate ? ` (${dueDate})` : "";
      return `2.1 O CONTRATANTE pagará ao CONTRATADO o valor total de ${amount} (${amountWords}), sendo efetuado o pagamento de ${reservation} (${moneyToWords(reservationCents)}, correspondente a 50% do valor total) para confirmação da data/local do evento. Os 50% restantes, no valor de ${remaining} (${moneyToWords(remainingCents)}), deverão ser quitados no dia anterior ao evento${dueDateText}${roundingNote}.`;
    }

    if (
      !Number.isInteger(data.installmentCount) ||
      data.installmentCount < 2 ||
      data.installmentCount > MAX_INSTALLMENTS ||
      data.installmentCount > data.totalCents
    ) {
      return "2.1 O CONTRATANTE pagará ao CONTRATADO conforme a quantidade de parcelas informada.";
    }

    const installments = getInstallments(data.totalCents, data.installmentCount);
    const regularAmount = outputCurrency.format(installments[0] / 100);
    const finalAmount = outputCurrency.format(installments[installments.length - 1] / 100);
    const hasAdjustment = installments.some((amountInCents) => amountInCents !== installments[0]);
    const installmentText = hasAdjustment
      ? `${data.installmentCount} parcelas: ${data.installmentCount - 1} de ${regularAmount} e a última de ${finalAmount}`
      : `${data.installmentCount} parcelas de ${regularAmount}`;
    return `2.1 O CONTRATANTE pagará ao CONTRATADO o valor total de ${amount} (${amountWords}), dividido em ${installmentText}, totalizando ${amount}.`;
  }

  function updateSummary(data) {
    paymentBreakdown.replaceChildren();
    paymentClause.textContent = makePaymentText(data);

    if (!data.totalCents) {
      summaryTitle.textContent = "Resumo do pagamento";
      summaryHint.textContent = "Os cálculos aparecem aqui conforme você preenche.";
      return;
    }

    summaryTitle.textContent = `Valor total: ${outputCurrency.format(data.totalCents / 100)}`;

    if (data.paymentMethod === "cash") {
      summaryHint.textContent = "Pagamento em uma única parcela.";
      addBreakdownItem("Pagamento à vista", data.totalCents);
      return;
    }

    if (data.paymentMethod === "reservation") {
      if (data.totalCents < 2) {
        summaryHint.textContent = "Informe pelo menos R$ 0,02 para dividir o pagamento em duas partes.";
        return;
      }
      const reservationCents = Math.ceil(data.totalCents / 2);
      const remainingCents = data.totalCents - reservationCents;
      summaryHint.textContent = "A reserva corresponde a 50%; o restante vence no dia anterior ao evento.";
      addBreakdownItem("50% para reserva", reservationCents);
      addBreakdownItem("50% restantes", remainingCents);
      if (data.totalCents % 2 !== 0) {
        summaryHint.textContent += " O ajuste de R$ 0,01 ocorre quando o total não pode ser dividido igualmente em centavos.";
      }
      return;
    }

    const count = data.installmentCount;
    if (
      !Number.isInteger(count) ||
      count < 2 ||
      count > MAX_INSTALLMENTS ||
      count > data.totalCents
    ) {
      summaryHint.textContent = `Informe de 2 a ${MAX_INSTALLMENTS} parcelas, sem exceder o valor total em centavos.`;
      return;
    }
    summaryHint.textContent = `${count} parcelas; os valores somam exatamente o total do contrato.`;
    getInstallments(data.totalCents, count).forEach((amount, index) => {
      addBreakdownItem(`${index + 1}ª parcela`, amount);
    });
  }

  function addBreakdownItem(label, cents) {
    const item = document.createElement("li");
    const labelNode = document.createElement("span");
    const amountNode = document.createElement("strong");
    labelNode.textContent = label;
    amountNode.textContent = outputCurrency.format(cents / 100);
    item.append(labelNode, amountNode);
    paymentBreakdown.append(item);
  }

  function validateForm(data) {
    if (!data.contractor) return "Informe o nome do contratante.";
    if (data.cpfDigits.length !== 11) return "Informe um CPF com 11 números.";
    if (data.services.length === 0) return "Informe ao menos um serviço contratado.";
    if (data.services.length > 3) return "O modelo comporta até três serviços; reúna os itens em até três linhas.";
    if (!data.address) return "Informe o endereço do evento.";
    if (!data.totalCents) return "Informe um valor total válido, maior que zero.";
    if (!data.eventDate) return "Informe a data do evento.";
    if (data.paymentMethod === "reservation" && data.totalCents < 2) {
      return "O valor total precisa ser de pelo menos R$ 0,02 para ser dividido em duas partes.";
    }
    if (
      data.paymentMethod === "installments" &&
      (!Number.isInteger(data.installmentCount) ||
        data.installmentCount < 2 ||
        data.installmentCount > MAX_INSTALLMENTS ||
        data.installmentCount > data.totalCents)
    ) {
      return `Informe de 2 a ${MAX_INSTALLMENTS} parcelas, sem exceder o valor total em centavos.`;
    }
    return "";
  }

  function wrapText(text, font, fontSize, maxWidth) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = word;
    }
    if (current) lines.push(current);
    return lines;
  }

  function drawTextAtTop(page, text, x, baselineFromTop, font, size, color, maxWidth) {
    if (!text) return;
    let fontSize = size;
    const cropBox = page.getCropBox();
    if (maxWidth) {
      while (fontSize > 7 && font.widthOfTextAtSize(text, fontSize) > maxWidth) {
        fontSize -= 0.25;
      }
      if (font.widthOfTextAtSize(text, fontSize) > maxWidth) {
        throw new Error("Um dos textos é longo demais para caber no modelo do contrato.");
      }
    }
    page.drawText(text, {
      x,
      y: cropBox.y + cropBox.height - baselineFromTop,
      font,
      size: fontSize,
      color,
    });
  }

  function drawPaymentClause(page, text, font) {
    const fontSize = 9;
    const lines = wrapText(text, font, fontSize, 560);
    const maxLines = 4;
    if (lines.length > maxLines) {
      throw new Error(
        "A condição de pagamento ultrapassou o espaço do contrato. Reduza o número de parcelas ou o texto dos dados.",
      );
    }
    lines.forEach((line, index) => {
      drawTextAtTop(page, line, 17.2, 426.5 + index * 10.4, font, fontSize, WHITE);
    });
  }

  async function createPdfBytes(data) {
    const pdf = await PDFDocument.load(templateBytes);
    const page = pdf.getPage(0);
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    drawTextAtTop(page, data.contractor, 90, 210.8, regular, 9.5, GOLD, 220);
    drawTextAtTop(page, "CPF:", 319, 210.8, bold, 9.5, GOLD);
    const formattedCpf = data.cpfDigits
      ? data.cpfDigits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
      : "";
    drawTextAtTop(page, formattedCpf, 350, 210.8, bold, 9.5, GOLD, 195);
    drawTextAtTop(page, formatDate(data.eventDate), 446, 237.8, bold, 9, GOLD, 110);

    const serviceBaselines = [286.3, 299.8, 313.3];
    data.services.slice(0, serviceBaselines.length).forEach((service, index) => {
      drawTextAtTop(page, service, 32.7, serviceBaselines[index], regular, 9.5, WHITE, 525);
    });
    drawTextAtTop(page, data.address, 94, 370.4, regular, 10, WHITE, 470);
    drawPaymentClause(page, makePaymentText(data), regular);

    const signatureName = data.contractor;
    const signatureSize = Math.min(
      9,
      signatureName ? Math.max(7, 120 / (signatureName.length * 0.52)) : 9,
    );
    const signatureNameWidth = bold.widthOfTextAtSize(signatureName, signatureSize);
    drawTextAtTop(
      page,
      signatureName,
      468 - signatureNameWidth / 2,
      784.3,
      bold,
      signatureSize,
      WHITE,
    );
    drawTextAtTop(page, formattedCpf, 427, 795.2, bold, 9, WHITE, 95);

    return pdf.save();
  }

  async function renderPreview() {
    if (!templateBytes || !window.PDFLib || !pdfjsLib) return;
    const sequence = ++renderSequence;
    const data = getFormData();
    updateSummary(data);
    if (activeRenderTask) {
      const previousRenderTask = activeRenderTask;
      activeRenderTask = undefined;
      previousRenderTask.cancel();
    }
    previewOverlay.hidden = false;
    downloadButton.disabled = true;
    setStatus("Atualizando a prévia…");

    try {
      const bytes = await createPdfBytes(data);
      if (sequence !== renderSequence) return;
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      if (sequence !== renderSequence) {
        await pdf.destroy();
        return;
      }
      const pdfPage = await pdf.getPage(1);
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const containerWidth = previewCanvas.parentElement.clientWidth - 36;
      const scale = Math.min(1.35, containerWidth / baseViewport.width);
      const viewport = pdfPage.getViewport({ scale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      previewCanvas.width = Math.floor(viewport.width * pixelRatio);
      previewCanvas.height = Math.floor(viewport.height * pixelRatio);
      previewCanvas.style.width = `${Math.floor(viewport.width)}px`;
      previewCanvas.style.height = `${Math.floor(viewport.height)}px`;
      const renderTask = pdfPage.render({
        canvasContext: previewContext,
        viewport,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      activeRenderTask = renderTask;
      try {
        await renderTask.promise;
      } finally {
        if (activeRenderTask === renderTask) activeRenderTask = undefined;
      }
      await pdf.destroy();
      if (sequence !== renderSequence) return;
      previewOverlay.hidden = true;

      const error = validateForm(data);
      downloadButton.disabled = Boolean(error);
      if (error) {
        setStatus("Preencha os campos obrigatórios para baixar o contrato.");
      } else {
        setStatus("Prévia atualizada. Revise e baixe o contrato.");
      }
    } catch (error) {
      if (sequence !== renderSequence) return;
      previewOverlay.hidden = true;
      downloadButton.disabled = true;
      setStatus(error.message || "Não foi possível gerar a prévia.", "error");
    }
  }

  function schedulePreview() {
    window.clearTimeout(debounceTimer);
    const data = getFormData();
    updateSummary(data);
    installmentField.hidden = data.paymentMethod !== "installments";
    debounceTimer = window.setTimeout(renderPreview, 500);
  }

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = !message;
  }

  async function downloadPdf() {
    const data = getFormData();
    const error = validateForm(data);
    if (error) {
      showFormError(error);
      return;
    }
    showFormError("");
    downloadButton.disabled = true;
    setStatus("Gerando o PDF para download…");
    try {
      const bytes = await createPdfBytes(data);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Contrato-IeS-${data.eventDate || "evento"}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setStatus("Contrato baixado. Confira os dados antes de coletar assinaturas.");
    } catch (error) {
      showFormError(error.message || "Não foi possível gerar o PDF.");
      setStatus("Falha ao gerar o contrato.", "error");
    } finally {
      downloadButton.disabled = Boolean(validateForm(getFormData()));
    }
  }

  cpfInput.addEventListener("input", () => {
    const digits = cpfInput.value.replace(/\D/g, "").slice(0, 11);
    cpfInput.value = digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  });

  form.addEventListener("input", () => {
    showFormError("");
    schedulePreview();
  });
  form.addEventListener("change", () => {
    showFormError("");
    schedulePreview();
  });
  downloadButton.addEventListener("click", downloadPdf);
  async function initialize() {
    if (!window.PDFLib || !window.pdfjsLib) {
      setStatus("As bibliotecas de PDF não carregaram. Verifique a conexão e recarregue a página.", "error");
      previewOverlay.hidden = true;
      return;
    }
    try {
      ({ PDFDocument, StandardFonts, rgb } = window.PDFLib);
      pdfjsLib = window.pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        new URL("./assets/pdf.worker.min.js", document.baseURI).toString();
      GOLD = rgb(0.914, 0.761, 0.380);
      WHITE = rgb(1, 1, 1);
      const response = await fetch("./assets/contrato-base.pdf");
      if (!response.ok) throw new Error("Não foi possível carregar o modelo do contrato.");
      templateBytes = await response.arrayBuffer();
      schedulePreview();
    } catch (error) {
      previewOverlay.hidden = true;
      setStatus(error.message || "Não foi possível carregar o modelo do contrato.", "error");
    }
  }

  initialize();
})();
