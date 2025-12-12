// PDF.jsはindex.htmlで読み込み済み
const pdfjsLib = window.pdfjsLib;

/**
 * PDFファイルからテキストを抽出し、クリーンアップする関数
 * @param {File} file - PDFファイルオブジェクト
 * @returns {Promise<string>} 抽出されたテキスト
 */
async function extractTextFromPDF(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let text = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            text += pageText + '\n';
        }

        // クリーンアップ：改行と空白の正規化
        text = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

        return text;
    } catch (error) {
        throw new Error(`PDFテキスト抽出エラー: ${error.message}`);
    }
}

/**
 * PDFを画像に変換し、Base64エンコードする関数
 * @param {File} file - PDFファイルオブジェクト
 * @param {number} scale - 画像スケール（デフォルト: 2.0）
 * @returns {Promise<string[]>} Base64エンコードされた画像データの配列
 */
async function convertPDFToImages(file, scale = 2.0) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const images = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: scale });

            // Canvasを作成
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            // PDFページをCanvasにレンダリング
            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };
            await page.render(renderContext).promise;

            // CanvasをBase64画像に変換
            const imageData = canvas.toDataURL('image/png');
            images.push(imageData);
        }

        return images;
    } catch (error) {
        throw new Error(`PDF画像変換エラー: ${error.message}`);
    }
}

/**
 * 画像からモバイル最適化HTMLを生成する関数（Visionモデル用）
 * @param {string[]} images - Base64エンコードされた画像データの配列
 * @param {boolean} isStreaming - ストリーミングモードかどうか
 * @param {function} onChunk - チャンク受信時のコールバック（ストリーミング時のみ）
 * @returns {Promise<object>} 生成されたHTMLとメタデータ
 */
async function generateHtmlFromImages(images, isStreaming = false, onChunk = null, abortSignal = null, apiUrl = 'http://127.0.0.1:1234') {
    const systemPrompt = "あなたは専門的なウェブ開発者で、画像からモバイルフレンドリーなHTMLに変換するエキスパートです。レスポンシブデザイン、アクセシビリティ、読みやすさを重視し、構造化されたHTMLを出力します。回答はHTMLコードのみとしてください。画像の内容を分析し、適切なHTML構造に変換してください。モバイル用に最適化するため、収まりきらない物は横にスクロール可能な状態にしてください。絶対に省略しないでください！";
    const userPrompt = "このPDFの画像を分析して、元の内容を維持しつつモバイル最適化されたHTMLに変換してください。";

    try {
        const response = await fetch(`${apiUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: headers,
            mode: 'cors',
            signal: abortSignal, // 中断シグナルを追加
            body: JSON.stringify({
                model: 'local-model',
                messages: [
                    { role: 'system', content: systemPrompt },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: userPrompt },
                            ...images.map(image => ({
                                type: 'image_url',
                                image_url: { url: image }
                            }))
                        ]
                    }
                ],
                max_tokens: 8000,
                stream: isStreaming,
            }),
        });

        if (!response.ok) {
            throw new Error(`APIエラー: ${response.status} ${response.statusText}`);
        }

        if (isStreaming) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';
            let model = '';
            let usage = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 最後の不完全な行をバッファに残す

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.choices && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                                const content = parsed.choices[0].delta.content;
                                fullContent += content;
                                if (onChunk) onChunk(content, fullContent);
                            }
                            if (parsed.model) {
                                model = parsed.model;
                                // モデル情報を更新
                                modelInfo.textContent = `モデル: ${model}`;
                                modelInfo.style.display = 'block';
                            }
                            if (parsed.usage) {
                                usage = parsed.usage;
                                console.log('Streaming usage received:', usage); // デバッグ用
                                // モデル情報を最終更新
                                if (model) {
                                    modelInfo.textContent = `モデル: ${model}`;
                                    modelInfo.style.display = 'block';
                                }
                            }
                        } catch (e) {
                            // JSONパースエラーは無視
                        }
                    }
                }
            }

            // メタタグ（thinkingなど）に囲まれた範囲を削除
            let html = fullContent.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/gi, '');
            html = html.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');

            // ```html ... ``` からHTMLを抽出
            const codeMatch = html.match(/```html([\s\S]*?)```/);
            if (codeMatch) {
                html = codeMatch[1].trim();
            }

            return {
                html: html.trim(),
                model: model,
                usage: usage
            };
        } else {
            const data = await response.json();
            console.log('Non-streaming API response:', data); // デバッグ用
            let html = data.choices[0].message.content;

            // メタタグ（thinkingなど）に囲まれた範囲を削除
            html = html.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/gi, '');
            html = html.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');

            // ```html ... ``` からHTMLを抽出
            const codeMatch = html.match(/```html([\s\S]*?)```/);
            if (codeMatch) {
                html = codeMatch[1].trim();
            }

            return {
                html: html.trim(),
                model: data.model,
                usage: data.usage
            };
        }
    } catch (error) {
        throw new Error(`HTML生成エラー: ${error.message}`);
    }
}

/**
 * テキストからモバイル最適化HTMLを生成する関数
 * @param {string} text - 変換するテキスト
 * @param {boolean} isStreaming - ストリーミングモードかどうか
 * @param {function} onChunk - チャンク受信時のコールバック（ストリーミング時のみ）
 * @returns {Promise<object>} 生成されたHTMLとメタデータ
 */
async function generateHtmlFromText(text, isStreaming = false, onChunk = null, abortSignal = null, apiUrl = 'http://127.0.0.1:1234') {
    const systemPrompt = "あなたはテキストをモバイルフレンドリーなHTMLに変換するエキスパートです。レスポンシブデザイン、アクセシビリティ、読みやすさを重視し、構造化されたHTMLを出力します。注意書きなどは別の色を使用して、回答はHTMLコードのみとしてください。テキストデータから構造を予測して復元し、表組みにすべきところは表組みにしてください。その際モバイル用に最適化するため、収まりきらない物は横にスクロール可能な状態にしてください。ユーザーはHTML化してほしいテキストをのみ提供しますが、余計な空白などが入っている可能性があります。絶対に省略しないでください。";
    const fullPrompt = `${text}`;

    try {
        const response = await fetch(`${apiUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: headers,
            mode: 'cors',
            signal: abortSignal, // 中断シグナルを追加
            body: JSON.stringify({
                model: 'local-model',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: fullPrompt }
                ],
                max_tokens: 8000,
                stream: isStreaming,
            }),
        });

        if (!response.ok) {
            throw new Error(`APIエラー: ${response.status} ${response.statusText}`);
        }

        if (isStreaming) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';
            let model = '';
            let usage = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 最後の不完全な行をバッファに残す

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.choices && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                                const content = parsed.choices[0].delta.content;
                                fullContent += content;
                                if (onChunk) onChunk(content, fullContent);
                            }
                            if (parsed.model) {
                                model = parsed.model;
                                // モデル情報を更新
                                modelInfo.textContent = `モデル: ${model}`;
                                modelInfo.style.display = 'block';
                            }
                            if (parsed.usage) {
                                usage = parsed.usage;
                                // モデル情報を最終更新
                                if (model) {
                                    modelInfo.textContent = `モデル: ${model}`;
                                    modelInfo.style.display = 'block';
                                }
                            }
                        } catch (e) {
                            // JSONパースエラーは無視
                        }
                    }
                }
            }

            // メタタグ（thinkingなど）に囲まれた範囲を削除
            let html = fullContent.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
            html = html.replace(/<think>[\s\S]*?<\/think>/gi, '');

            // ```html ... ``` からHTMLを抽出
            const codeMatch = html.match(/```html([\s\S]*?)```/);
            if (codeMatch) {
                html = codeMatch[1].trim();
            }

            return {
                html: html.trim(),
                model: model,
                usage: usage
            };
        } else {
            const data = await response.json();
            let html = data.choices[0].message.content;

            console.log('Vision API non-streaming response:', data); // デバッグ用
            // メタタグ（thinkingなど）に囲まれた範囲を削除
            html = html.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
            html = html.replace(/<think>[\s\S]*?<\/think>/gi, '');

            // ```html ... ``` からHTMLを抽出
            const codeMatch = html.match(/```html([\s\S]*?)```/);
            if (codeMatch) {
                html = codeMatch[1].trim();
            }

            return {
                html: html.trim(),
                model: data.model,
                usage: data.usage
            };
        }
    } catch (error) {
        throw new Error(`HTML生成エラー: ${error.message}`);
    }
}

// Service Worker登録とPWAインストール
let deferredPrompt;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then((registration) => {
                console.log('Service Worker registered successfully:', registration.scope);
            })
            .catch((error) => {
                console.log('Service Worker registration failed:', error);
            });
    });
}

// PWAインストールプロンプト
window.addEventListener('beforeinstallprompt', (e) => {
    console.log('PWA install prompt triggered');
    e.preventDefault();
    deferredPrompt = e;

    // インストールボタンを表示（オプション）
    showInstallButton();
});

function showInstallButton() {
    // インストールボタンを作成（必要に応じて）
    const installBtn = document.createElement('button');
    installBtn.textContent = '📱 アプリをインストール';
    installBtn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #007bff;
        color: white;
        border: none;
        padding: 12px 20px;
        border-radius: 25px;
        font-size: 14px;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        z-index: 1000;
    `;

    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to install prompt: ${outcome}`);
            deferredPrompt = null;
            installBtn.remove();
        }
    });

    document.body.appendChild(installBtn);

    // 5秒後に自動非表示
    setTimeout(() => {
        if (installBtn.parentNode) {
            installBtn.remove();
        }
    }, 5000);
}

// UI統合
document.addEventListener('DOMContentLoaded', () => {
    const apiUrlInput = document.getElementById('apiUrl');
    const apiTokenInput = document.getElementById('apiToken');
    const pdfInput = document.getElementById('pdfInput');
    const streamingToggle = document.getElementById('streamingToggle');
    const visionToggle = document.getElementById('visionToggle');
    const processBtn = document.getElementById('processBtn');
    const stopBtn = document.getElementById('stopBtn');
    const status = document.getElementById('status');
    const extractedText = document.getElementById('extractedText');
    const textContainer = document.getElementById('textContainer');
    const streamingOutput = document.getElementById('streamingOutput');
    const streamingContainer = document.getElementById('streamingContainer');
    const imagePreview = document.getElementById('imagePreview');
    const imageContainer = document.getElementById('imageContainer');
    const modelInfo = document.getElementById('modelInfo');
    const preview = document.getElementById('preview');
    const previewContainer = document.getElementById('previewContainer');
    const downloadBtn = document.getElementById('downloadBtn');

    // Shadow DOMでスタイルを隔離
    const shadowRoot = preview.attachShadow({ mode: 'open' });

    let generatedHtml = '';
    let extractedTextContent = '';
    let processingInfo = {};
    let abortController = null; // ストリーミング処理中断用

    const showStatus = (message) => {
        status.textContent = message;
        status.style.display = 'block';
    };

    const hideStatus = () => {
        status.style.display = 'none';
    };

    // 共有ファイルの処理
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('shared') === 'true') {
        showStatus('共有されたPDFファイルを読み込みました。処理を開始してください。');
        // デバッグ情報
        console.log('Shared file detected via URL params');
    } else if (urlParams.get('error') === 'share_failed') {
        showStatus('共有ファイルの処理に失敗しました。');
        console.error('Share target processing failed');
    }

    // Service Workerメッセージの処理（共有ファイル用）
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'SHARED_FILE_RECEIVED') {
                console.log('Shared file received via Service Worker:', event.data.file);
                showStatus('共有ファイルを受信しました。');
            }
        });
    }

    // 停止ボタンのイベントリスナー
    stopBtn.addEventListener('click', () => {
        if (abortController) {
            abortController.abort();
            abortController = null;
            showStatus('処理を停止しました');

            // 処理関連のセクションを非表示
            textContainer.style.display = 'none';
            streamingContainer.style.display = 'none';
            imageContainer.style.display = 'none';
            previewContainer.style.display = 'none';
            downloadBtn.style.display = 'none';
            modelInfo.style.display = 'none';

            processBtn.disabled = false;
            processBtn.textContent = '処理';
            stopBtn.style.display = 'none';
        }
    });

    processBtn.addEventListener('click', async () => {
        const file = pdfInput.files[0];
        if (!file) {
            alert('PDFファイルを選択してください。');
            return;
        }

        // 以前の結果をリセット
        textContainer.style.display = 'none';
        streamingContainer.style.display = 'none';
        imageContainer.style.display = 'none';
        previewContainer.style.display = 'none';
        downloadBtn.style.display = 'none';
        modelInfo.style.display = 'none';
        extractedText.textContent = '';
        streamingOutput.textContent = '';
        imagePreview.innerHTML = '';
        modelInfo.textContent = '';
        shadowRoot.innerHTML = '';

        processBtn.disabled = true;
        processBtn.textContent = '処理中...';

        const isVision = visionToggle.checked;
        const isStreaming = streamingToggle.checked;
        let apiUrl = apiUrlInput.value.trim() || 'http://127.0.0.1:1234';
        const apiToken = apiTokenInput.value.trim();

        // API URLがプロトコルを含まない場合、https://を付ける
        if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
            apiUrl = 'https://' + apiUrl;
        }

        // Authorizationヘッダーの準備
        const headers = {
            'Content-Type': 'application/json',
        };
        if (apiToken) {
            headers['Authorization'] = `Bearer ${apiToken}`;
        }

        let hasReasoning = false;

        try {
            if (isVision) {
                // Visionモデルモード
                showStatus('PDFを画像に変換しています...');
                const images = await convertPDFToImages(file);

                // 変換された画像をプレビュー表示
                imagePreview.innerHTML = '';
                images.forEach((imageData, index) => {
                    const pageDiv = document.createElement('div');
                    const label = document.createElement('div');
                    label.className = 'page-label';
                    label.textContent = `ページ ${index + 1}`;
                    const img = document.createElement('img');
                    img.src = imageData;
                    img.alt = `ページ ${index + 1}`;
                    pageDiv.appendChild(label);
                    pageDiv.appendChild(img);
                    imagePreview.appendChild(pageDiv);
                });
                imageContainer.style.display = 'block';

                showStatus('AIでHTMLを生成しています...');

                if (isStreaming) {
                    // AbortControllerを作成
                    abortController = new AbortController();
                    stopBtn.style.display = 'inline-block';

                    streamingOutput.textContent = '';
                    streamingContainer.style.display = 'block';

                    const startTime = Date.now();
                    // 経過時間をリアルタイム更新（モデル情報に表示）
                    const updateInterval = setInterval(() => {
                        const elapsed = (Date.now() - startTime) / 1000;
                        if (modelInfo.style.display !== 'none') {
                            const currentText = modelInfo.textContent;
                            if (currentText.includes('モデル:')) {
                                // モデル情報が表示されている場合は何もしない
                            }
                        }
                    }, 100);

                    let result;
                    try {
                        result = await generateHtmlFromImages(images, isStreaming, (chunk, fullContent) => {
                            if (fullContent.includes('<thinking>') || fullContent.includes('<think>')) {
                                hasReasoning = true;
                            }

                            let thinkingContent = '';
                            if (fullContent.includes('<thinking>')) {
                                const thinkingMatch = fullContent.match(/<thinking>([\s\S]*?)(<\/thinking>|$)/);
                                if (thinkingMatch) thinkingContent = thinkingMatch[1];
                            } else if (fullContent.includes('<think>')) {
                                const thinkMatch = fullContent.match(/<think>([\s\S]*?)(<\/think>|$)/);
                                if (thinkMatch) thinkingContent = thinkMatch[1];
                            }
                            streamingOutput.textContent = thinkingContent;

                            let htmlContent = fullContent.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/gi, '');
                            htmlContent = htmlContent.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');

                            const codeMatch = htmlContent.match(/```html([\s\S]*?)```/);
                            if (codeMatch) {
                                htmlContent = codeMatch[1].trim();
                            }

                            if (htmlContent.trim()) {
                                shadowRoot.innerHTML = htmlContent.trim();
                                previewContainer.style.display = 'block';
                            }

                            streamingOutput.scrollTop = streamingOutput.scrollHeight;
                        }, abortController.signal, apiUrl);

                        clearInterval(updateInterval);
                        abortController = null;
                        stopBtn.style.display = 'none';
                    } catch (error) {
                        clearInterval(updateInterval);
                        abortController = null;
                        stopBtn.style.display = 'none';
                        if (error.name === 'AbortError') {
                            throw new Error('処理が中断されました');
                        }
                        throw error;
                    }

                    generatedHtml = result.html;
                    processingInfo = {
                        model: result.model,
                        usage: result.usage,
                        processingTime: Date.now() - startTime
                    };

                    if (!hasReasoning) {
                        streamingContainer.style.display = 'none';
                    }

                    // モデル情報を表示
                    if (processingInfo.model) {
                        modelInfo.textContent = `モデル: ${processingInfo.model}`;
                        modelInfo.style.display = 'block';
                    }
                } else {
                    const startTime = Date.now();
                    const result = await generateHtmlFromImages(images, isStreaming, null, null, apiUrl);
                    const endTime = Date.now();

                    generatedHtml = result.html;
                    processingInfo = {
                        model: result.model,
                        usage: result.usage,
                        processingTime: endTime - startTime
                    };

                    // モデル情報を表示
                    if (processingInfo.model) {
                        modelInfo.textContent = `モデル: ${processingInfo.model}`;
                        modelInfo.style.display = 'block';
                    }
                }

                shadowRoot.innerHTML = generatedHtml;
                previewContainer.style.display = 'block';
                downloadBtn.style.display = 'block';
            } else {
                // テキストモデルモード
                showStatus('PDFからテキストを抽出しています...');
                extractedTextContent = await extractTextFromPDF(file);
                extractedText.textContent = extractedTextContent;
                textContainer.style.display = 'block';

                showStatus('AIでHTMLを生成しています...');

                if (isStreaming) {
                    // AbortControllerを作成
                    abortController = new AbortController();
                    stopBtn.style.display = 'inline-block';

                    streamingOutput.textContent = '';
                    streamingContainer.style.display = 'block';

                    const startTime = Date.now();
                    // 経過時間をリアルタイム更新（モデル情報に表示）
                    const updateInterval = setInterval(() => {
                        const elapsed = (Date.now() - startTime) / 1000;
                        if (modelInfo.style.display !== 'none') {
                            const currentText = modelInfo.textContent;
                            if (currentText.includes('モデル:')) {
                                // モデル情報が表示されている場合は何もしない
                            }
                        }
                    }, 100);

                    let result;
                    try {
                        result = await generateHtmlFromText(extractedTextContent, isStreaming, (chunk, fullContent) => {
                            if (fullContent.includes('<thinking>') || fullContent.includes('<think>')) {
                                hasReasoning = true;
                            }

                            let thinkingContent = '';
                            if (fullContent.includes('<thinking>')) {
                                const thinkingMatch = fullContent.match(/<thinking>([\s\S]*?)(<\/thinking>|$)/);
                                if (thinkingMatch) thinkingContent = thinkingMatch[1];
                            } else if (fullContent.includes('<think>')) {
                                const thinkMatch = fullContent.match(/<think>([\s\S]*?)(<\/think>|$)/);
                                if (thinkMatch) thinkingContent = thinkMatch[1];
                            }
                            streamingOutput.textContent = thinkingContent;

                            let htmlContent = fullContent.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/gi, '');
                            htmlContent = htmlContent.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');

                            const codeMatch = htmlContent.match(/```html([\s\S]*?)```/);
                            if (codeMatch) {
                                htmlContent = codeMatch[1].trim();
                            }

                            if (htmlContent.trim()) {
                                shadowRoot.innerHTML = htmlContent.trim();
                                previewContainer.style.display = 'block';
                            }

                            streamingOutput.scrollTop = streamingOutput.scrollHeight;
                        }, abortController.signal, apiUrl);

                        clearInterval(updateInterval);
                        abortController = null;
                        stopBtn.style.display = 'none';
                    } catch (error) {
                        clearInterval(updateInterval);
                        abortController = null;
                        stopBtn.style.display = 'none';
                        if (error.name === 'AbortError') {
                            throw new Error('処理が中断されました');
                        }
                        throw error;
                    }

                    generatedHtml = result.html;
                    processingInfo = {
                        model: result.model,
                        usage: result.usage,
                        processingTime: Date.now() - startTime
                    };

                    if (!hasReasoning) {
                        streamingContainer.style.display = 'none';
                    }

                    // モデル情報を表示
                    if (processingInfo.model) {
                        modelInfo.textContent = `モデル: ${processingInfo.model}`;
                        modelInfo.style.display = 'block';
                    }
                } else {
                    const startTime = Date.now();
                    const result = await generateHtmlFromText(extractedTextContent, isStreaming, null, null, apiUrl);
                    const endTime = Date.now();

                    generatedHtml = result.html;
                    processingInfo = {
                        model: result.model,
                        usage: result.usage,
                        processingTime: endTime - startTime
                    };

                    // モデル情報を表示
                    if (processingInfo.model) {
                        modelInfo.textContent = `モデル: ${processingInfo.model}`;
                        modelInfo.style.display = 'block';
                    }
                }

                shadowRoot.innerHTML = generatedHtml;
                previewContainer.style.display = 'block';
                downloadBtn.style.display = 'block';
            }

            hideStatus();
        } catch (error) {
            hideStatus();
            if (error.message !== '処理が中断されました') {
                alert(error.message);
            }
        } finally {
            processBtn.disabled = false;
            processBtn.textContent = '処理';
            abortController = null;
            stopBtn.style.display = 'none';
        }
    });

    downloadBtn.addEventListener('click', () => {
        const blob = new Blob([generatedHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'converted.html';
        a.click();
        URL.revokeObjectURL(url);
    });
});

export { extractTextFromPDF, convertPDFToImages, generateHtmlFromText, generateHtmlFromImages };


