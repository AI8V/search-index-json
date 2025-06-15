(function () {
    'use strict';

    const DEFAULT_BASE_SCHEMA_OBJ = { "@context": "https://schema.org", "@type": ["WebSite", "Organization"], "@id": "https://example.com/#website", name: "Your Organization Name", url: "https://example.com", logo: "https://example.com/logo.png", sameAs: ["https://www.facebook.com/your-profile", "https://twitter.com/your-profile"], potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: "https://example.com/search?q={search_term_string}" }, "query-input": "required name=search_term_string" } };
    const DEFAULT_BASE_SCHEMA_STR = JSON.stringify(DEFAULT_BASE_SCHEMA_OBJ, null, 2);

    const appState = {
        searchIndex: [], manualPages: [], analyzedFiles: [], sitemapUrls: [],
        robotsUrls: [], manifestData: {}, filteredResults: [],
        selectedItemIds: new Set(),
        schemaConfig: { baseUrl: '', pageSchemaType: 'WebPage', baseSchema: DEFAULT_BASE_SCHEMA_STR }
    };
    
    const PROJECTS_MASTER_KEY = 'searchIndexGenerator_projects';
    const LAST_PROJECT_KEY = 'searchIndexGenerator_lastProject';
    const VIRTUAL_SCROLL_CHUNK_SIZE = 15;

    const dom = {};
    let resultItemTemplate, saveTimeout;
    let sourceChartInstance, keywordsChartInstance, seoScoreChartInstance;

    const getEl = (id) => document.getElementById(id);

    function setDarkMode(isDark) {
        localStorage.setItem('darkMode', String(isDark));
        document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
        updateDarkModeButton();
    }

    function toggleDarkMode() {
        const newIsDarkMode = document.documentElement.getAttribute('data-bs-theme') !== 'dark';
        setDarkMode(newIsDarkMode);
        const modeText = newIsDarkMode ? 'الليلي' : 'النهاري';
        const icon = newIsDarkMode ? 'bi-moon-stars-fill' : 'bi-sun-fill';
        showNotification(`<i class="bi ${icon} ms-2"></i> تم تفعيل الوضع ${modeText}`, 'info');
    }

    function updateDarkModeButton() {
        const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
        dom.darkModeToggle.innerHTML = isDark
            ? `<i class="bi bi-sun-fill"></i> <span class="d-none d-sm-inline">الوضع النهاري</span>`
            : `<i class="bi bi-moon-stars-fill"></i> <span class="d-none d-sm-inline">الوضع الليلي</span>`;
    }

    function getProxyUrl(targetUrl) {
        const customProxy = dom.customProxyUrl.value.trim();
        return customProxy ? customProxy.replace('{url}', encodeURIComponent(targetUrl)) : `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    }

    async function startSeoCrawler() {
        let baseUrl = dom.seoCrawlerUrl.value.trim();
        if (!baseUrl) return showNotification('يرجى إدخال رابط الموقع للزحف', 'warning');

        try {
            if (!/^https?:\/\//i.test(baseUrl)) { baseUrl = 'https://' + baseUrl; dom.seoCrawlerUrl.value = baseUrl; }
            const parsedUrl = new URL(baseUrl);
            dom.schemaBaseUrl.value = parsedUrl.origin;
            appState.schemaConfig.baseUrl = parsedUrl.origin;
        } catch (e) { return showNotification('رابط الموقع غير صالح', 'danger'); }

        const maxDepth = parseInt(dom.seoCrawlerDepth.value, 10) || 0;
        const origin = new URL(baseUrl).origin;
        showNotification(`<i class="bi bi-rocket-takeoff-fill ms-2"></i> بدء زحف SEO لـ ${origin}...`, 'info');

        dom.crawlerStatus.classList.remove('d-none');
        let queue = [{ url: baseUrl, depth: 0 }];
        const visited = new Set([baseUrl]);
        const crawledData = new Map();
        const brokenLinks = new Set();

        const updateCrawlerUI = (processed, q) => {
            const total = processed + q.length;
            dom.crawlerProgressBar.style.width = total > 0 ? `${(processed / total) * 100}%` : '0%';
            dom.crawlerProgressText.textContent = `${processed}/${total}`;
            dom.crawlerQueueCount.textContent = `في الانتظار: ${q.length}`;
        };

        let processedCount = 0;
        updateCrawlerUI(processedCount, queue);

        while (queue.length > 0) {
            const { url, depth } = queue.shift();
            processedCount++;
            dom.crawlerCurrentUrl.textContent = `فحص: ${new URL(url).pathname}...`;
            updateCrawlerUI(processedCount, queue);
            try {
                const startTime = performance.now();
                const response = await fetch(getProxyUrl(url));
                if (!response.ok) throw new Error(`Status ${response.status}`);
                const html = await response.text();
                const analysis = analyzeHtmlContent(html, url, { loadTime: Math.round(performance.now() - startTime) });
                const linksOnPage = new Set();
                new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a[href]').forEach(link => {
                    const href = link.getAttribute('href');
                    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
                    try {
                        const absoluteUrl = new URL(href, url).href;
                        linksOnPage.add(absoluteUrl);
                        if (absoluteUrl.startsWith(origin) && !visited.has(absoluteUrl) && depth < maxDepth && !/\.(jpg|jpeg|png|gif|svg|css|js|pdf|zip)$/i.test(absoluteUrl)) {
                            visited.add(absoluteUrl);
                            queue.push({ url: absoluteUrl, depth: depth + 1 });
                        }
                    } catch (e) { /* Ignore */ }
                });
                crawledData.set(url, { analysis, outgoingLinks: [...linksOnPage] });
            } catch (error) {
                console.error(`فشل في جلب ${url}:`, error);
                brokenLinks.add(url);
                showNotification(`<i class="bi bi-exclamation-triangle-fill ms-2"></i> فشل الاتصال بـ: ${new URL(url).pathname}`, 'warning');
            }
            await new Promise(r => setTimeout(r, 100));
        }

        dom.crawlerCurrentUrl.innerHTML = '<p class="text-center text-success fw-bold">اكتمل الزحف! جاري تحليل البيانات...</p>';
        dom.crawlerProgressBar.style.width = '100%';

        // --- START: ADVANCED ARCHITECTURE ANALYSIS ---
        const allFoundUrls = new Set(crawledData.keys());
        const allLinkedToUrls = new Set();
        const linkEquityMap = new Map();

        crawledData.forEach(data => {
            data.outgoingLinks.forEach(link => {
                const cleanLink = link.split('#')[0].split('?')[0];
                if (allFoundUrls.has(cleanLink)) {
                   allLinkedToUrls.add(cleanLink);
                   // Increment link count for the target page
                   linkEquityMap.set(cleanLink, (linkEquityMap.get(cleanLink) || 0) + 1);
                }
            });
        });
        
        crawledData.forEach((data, url) => {
            // Assign Orphan status
            data.analysis.seo.isOrphan = !allLinkedToUrls.has(url) && url !== baseUrl;
            // Assign Broken links
            data.analysis.seo.brokenLinksOnPage = data.outgoingLinks.filter(link => brokenLinks.has(link));
            // Assign Link Equity Score
            data.analysis.seo.internalLinkEquity = linkEquityMap.get(url) || 0;
        });
        // --- END: ADVANCED ARCHITECTURE ANALYSIS ---
        
        const orphanCount = [...crawledData.values()].filter(d => d.analysis.seo.isOrphan).length;
        if (orphanCount > 0) showNotification(`<i class="bi bi-exclamation-diamond-fill ms-2"></i> تم اكتشاف ${orphanCount} صفحة معزولة!`, 'warning', 7000);
        
        const newItems = Array.from(crawledData.values()).map(({ analysis }) => ({ ...analysis, category: 'زاحف SEO', tags: analysis.keywords.length > 0 ? analysis.keywords : extractTagsFromUrl(analysis.url), source: 'seo_crawler' }));
        const addedCount = addItemsToIndex(newItems);
        
        showNotification(
            addedCount > 0 ? `<i class="bi bi-check-circle-fill ms-2"></i> اكتمل الزحف! تمت إضافة ${addedCount} صفحة جديدة.` :
            crawledData.size > 0 ? '🏁 اكتمل الزحف. جميع الصفحات التي تم العثور عليها موجودة بالفعل.' :
            '❌ فشل الزحف. لم يتم العثور على أي صفحات قابلة للوصول.',
            addedCount > 0 ? 'success' : (crawledData.size > 0 ? 'info' : 'danger')
        );
        
        if (brokenLinks.size > 0) showNotification(`<i class="bi bi-exclamation-octagon-fill ms-2"></i> تم العثور على ${brokenLinks.size} رابط داخلي مكسور.`, 'danger', 7000);
        setTimeout(() => {
            dom.crawlerStatus.classList.add('d-none');
            dom.crawlerCurrentUrl.textContent = 'بدء العملية...';
        }, 5000);
        updateAllUI();
        debouncedSaveProject();
    }

    function analyzeHtmlContent(content, urlOrFilename, options = {}) {
        const doc = new DOMParser().parseFromString(content, 'text/html');
        const isUrl = urlOrFilename.startsWith('http');
        const url = isUrl ? new URL(urlOrFilename) : null;
        const filename = isUrl ? (url.pathname.split('/').pop() || 'index.html') : urlOrFilename;
    
        let pageTypeHint = 'generic';
        const lowerUrl = urlOrFilename.toLowerCase();
        if (lowerUrl.includes('/blog/') || lowerUrl.includes('/article/')) pageTypeHint = 'article';
        else if (lowerUrl.includes('/product')) pageTypeHint = 'product';
        else if (lowerUrl.includes('/contact')) pageTypeHint = 'contact';
        else if (lowerUrl.includes('/about')) pageTypeHint = 'about';
        else if (filename === 'index.html' || url?.pathname === '/') pageTypeHint = 'homepage';

        const title = doc.querySelector('title')?.textContent.trim() || filename.replace(/\.(html?|htm)$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const description = doc.querySelector('meta[name="description"]')?.getAttribute('content') || doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || `صفحة ${title}`;
        const bodyText = doc.body?.textContent.trim() || '';
        const words = bodyText.split(/\s+/).filter(Boolean);
        const sentences = bodyText.match(/[^.!?]+[.!?]+/g) || [];
        const pageHostname = url?.hostname || window.location.hostname;
        
        let internalLinks = 0, externalLinks = 0;
        doc.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
            try {
                const linkUrl = new URL(href, urlOrFilename);
                if (linkUrl.hostname === pageHostname) internalLinks++;
                else if (linkUrl.protocol.startsWith('http')) externalLinks++;
            } catch {
                if (!/^(https?:)?\/\//.test(href)) internalLinks++;
            }
        });
        
        const syllableApproximation = words.reduce((acc, word) => acc + (word.match(/[aeiouy]{1,2}/gi) || []).length, 0);
        
        const seoData = {
            h1: doc.querySelector('h1')?.textContent.trim() || null,
            lang: doc.documentElement.getAttribute('lang') || null,
            canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
            imageAltInfo: { total: doc.images.length, missing: [...doc.images].filter(img => !img.alt?.trim()).length },
            brokenLinksOnPage: [],
            loadTime: options.loadTime || null,
            isNoIndex: /noindex/i.test(doc.querySelector('meta[name="robots"]')?.content),
            isOrphan: false,
            internalLinkEquity: 0,
            ogTitle: doc.querySelector('meta[property="og:title"]')?.content || null,
            ogImage: doc.querySelector('meta[property="og:image"]')?.content || null,
            hasStructuredData: !!doc.querySelector('script[type="application/ld+json"]'),
            wordCount: words.length, pageTypeHint,
            contentAnalysis: { internalLinks, externalLinks, readabilityScore: sentences.length > 0 && words.length > 0 ? Math.max(0, 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllableApproximation / words.length)).toFixed(1) : null },
            performance: { pageSizeKB: (content.length / 1024).toFixed(1), resourceCounts: { js: doc.scripts.length, css: doc.querySelectorAll('link[rel="stylesheet"]').length, images: doc.images.length } },
            accessibility: { formLabels: { total: doc.querySelectorAll('input, textarea, select').length, missing: [...doc.querySelectorAll('input:not([type=hidden]), textarea, select')].filter(el => !el.id || !doc.querySelector(`label[for="${el.id}"]`)).length }, semanticHeaders: !!doc.querySelector('header'), semanticNav: !!doc.querySelector('nav'), semanticMain: !!doc.querySelector('main') }
        };
        return { filename, title, description, keywords: doc.querySelector('meta[name="keywords"]')?.content?.split(',').map(k => k.trim()).filter(Boolean) || [], url: isUrl ? url.pathname : '/' + filename, source: isUrl ? 'seo_crawler' : 'html_analysis', content, seo: seoData };
    }

    function handleGenerateClick() {
        const newItems = generateSearchIndex();
        if (newItems.length === 0 && appState.searchIndex.length === 0) return showNotification('يرجى إدخال بيانات أولاً', 'warning');
        const addedCount = addItemsToIndex(newItems);
        showNotification(addedCount > 0 ? `تم إضافة ${addedCount} عنصر جديد! الإجمالي: ${appState.searchIndex.length}` : 'لا توجد عناصر جديدة للإضافة. النتائج محدّثة.', addedCount > 0 ? 'success' : 'info');
        updateAllUI();
        debouncedSaveProject();
    }

    function addItemsToIndex(itemsToAdd) {
        const existingUrls = new Set(appState.searchIndex.map(item => (item.url.endsWith('/') && item.url.length > 1 ? item.url.slice(0, -1) : item.url)));
        let idCounter = appState.searchIndex.length > 0 ? Math.max(0, ...appState.searchIndex.map(item => item.id)) + 1 : 1;
        let addedCount = 0;
        itemsToAdd.forEach(item => {
            const urlKey = item.url.endsWith('/') && item.url.length > 1 ? item.url.slice(0, -1) : item.url;
            if (!existingUrls.has(urlKey)) {
                item.id = idCounter++;
                appState.searchIndex.push(item);
                existingUrls.add(urlKey);
                addedCount++;
            }
        });
        return addedCount;
    }

    function generateSearchIndex() {
        const newItems = [];
        const existingUrls = new Set(appState.searchIndex.map(item => (item.url.endsWith('/') && item.url.length > 1 ? item.url.slice(0, -1) : item.url)));
        const addItem = (item) => {
            const urlKey = item.url.endsWith('/') && item.url.length > 1 ? item.url.slice(0, -1) : item.url;
            if (!existingUrls.has(urlKey)) newItems.push(item);
        };
        appState.analyzedFiles.forEach(file => addItem({ ...file, category: file.category || (file.source === 'seo_crawler' ? 'زاحف SEO' : 'تحليل تلقائي'), tags: file.keywords?.length > 0 ? file.keywords : extractTagsFromUrl(file.url), source: file.source || 'html_analysis' }));
        if (dom.manualInput.checked) appState.manualPages.forEach(page => addItem({ ...page, source: 'manual' }));
        dom.urlInput.value.trim().split('\n').filter(Boolean).forEach(urlStr => {
            const url = urlStr.trim().startsWith('/') ? urlStr.trim() : '/' + urlStr.trim();
            const urlKey = url.endsWith('/') && url.length > 1 ? url.slice(0, -1) : url;
            if (existingUrls.has(urlKey)) return;
            const fileName = url.split('/').pop().replace(/\.html?$/, '');
            const category = url.split('/').filter(Boolean)[0] || 'عام';
            const titleMap = { 'index': 'الصفحة الرئيسية', 'about': 'من نحن', 'contact': 'اتصل بنا', 'services': 'خدماتنا', 'blog': 'المدونة' };
            const title = titleMap[fileName.toLowerCase()] || (fileName.charAt(0).toUpperCase() + fileName.slice(1).replace(/[-_]/g, ' '));
            const source = appState.sitemapUrls.includes(url) ? 'sitemap' : appState.robotsUrls.includes(url) ? 'robots' : 'url_generation';
            addItem({ title, description: `صفحة ${title}`, url, category: category.charAt(0).toUpperCase() + category.slice(1), tags: extractTagsFromUrl(url), source });
        });
        return newItems;
    }

    function calculateSeoScore(seo) {
        if (!seo) return { score: 0, maxScore: 9, color: '#6c757d', level: 'غير متوفر' };
        let score = 0; const maxScore = 9;
        if (seo.h1) score++;
        if (seo.canonical) score++;
        if (seo.imageAltInfo.total > 0 && seo.imageAltInfo.missing === 0) score++;
        if (seo.brokenLinksOnPage.length === 0) score++;
        if (!seo.isNoIndex) score++;
        if (seo.lang) score++;
        if (seo.ogTitle && seo.ogImage) score++;
        if (seo.hasStructuredData) score++;
        const thresholds = { article: 500, product: 250, homepage: 250, about: 50, contact: 50, generic: 300 };
        if (seo.wordCount >= (thresholds[seo.pageTypeHint] || thresholds.generic)) score++;
        const percentage = (score / maxScore) * 100;
        if (percentage >= 80) return { score, maxScore, color: '#198754', level: 'ممتاز' };
        if (percentage >= 50) return { score, maxScore, color: '#ffc107', level: 'جيد' };
        return { score, maxScore, color: '#dc3545', level: 'يحتاج لمراجعة' };
    }

    function renderSeoSummary(seo, itemId) {
        if (!seo) return '';
        const createBadge = (text, type, title = '') => `<span class="badge bg-${type}" title="${title}">${text}</span>`;
        const pageTypeLabels = { 'generic': 'عامة', 'article': 'مقالة', 'product': 'منتج', 'contact': 'اتصال', 'about': 'من نحن', 'homepage': 'رئيسية' };
        
        let equityBadge = '';
        if (typeof seo.internalLinkEquity === 'number') {
            let badgeType = 'secondary';
            if (seo.internalLinkEquity > 10) badgeType = 'warning text-dark';
            else if (seo.internalLinkEquity > 3) badgeType = 'info';
            equityBadge = `<div class="seo-summary-item"><strong>قوة الصفحة:</strong> ${createBadge(seo.internalLinkEquity, badgeType, 'قوة الربط الداخلي: عدد الروابط الداخلية التي تشير لهذه الصفحة.')}</div>`;
        }
        
        const basicSeoHtml = `<div class="mt-2 pt-2 border-top border-opacity-10">
            <strong class="small text-body-secondary d-block mb-1">SEO أساسي:</strong>
            <div class="seo-summary-item"><strong>نوع الصفحة:</strong> ${createBadge(pageTypeLabels[seo.pageTypeHint] || 'غير محدد', 'primary')}</div>
            ${equityBadge}
            <div class="seo-summary-item"><strong>H1:</strong> ${createBadge(seo.h1 ? 'موجود' : 'مفقود', seo.h1 ? 'success' : 'danger')}</div>
            <div class="seo-summary-item"><strong>Lang:</strong> ${createBadge(seo.lang || 'مفقود', seo.lang ? 'success' : 'danger')}</div>
            <div class="seo-summary-item"><strong>Canonical:</strong> ${createBadge(seo.canonical ? 'موجود' : 'مفقود', seo.canonical ? 'success' : 'danger')}</div>
            <div class="seo-summary-item"><strong>Img Alt:</strong> ${seo.imageAltInfo.total === 0 ? createBadge('لا يوجد', 'secondary') : createBadge(`${seo.imageAltInfo.total - seo.imageAltInfo.missing}/${seo.imageAltInfo.total}`, seo.imageAltInfo.missing === 0 ? 'success' : 'warning')}</div>
            <div class="seo-summary-item"><strong>روابط مكسورة:</strong> ${seo.brokenLinksOnPage?.length > 0 ? `<span class="badge bg-danger cursor-pointer" data-bs-toggle="collapse" href="#brokenLinks-${itemId}">${seo.brokenLinksOnPage.length}</span><div class="collapse mt-2" id="brokenLinks-${itemId}"><ul class="list-group list-group-flush small">${seo.brokenLinksOnPage.map(l => `<li class="list-group-item list-group-item-danger py-1 px-2 text-break">${l}</li>`).join('')}</ul></div>` : createBadge('0', 'success')}</div>
            <div class="seo-summary-item"><strong>OG Tags:</strong> ${createBadge(seo.ogTitle && seo.ogImage ? 'موجود' : 'ناقص', seo.ogTitle && seo.ogImage ? 'success' : 'warning', 'OG:Title/Image')}</div>
            <div class="seo-summary-item"><strong>بيانات منظمة:</strong> ${createBadge(seo.hasStructuredData ? 'موجود' : 'مفقود', seo.hasStructuredData ? 'success' : 'secondary')}</div>
            <div class="seo-summary-item"><strong>عدد الكلمات:</strong> ${createBadge(seo.wordCount, seo.wordCount > 300 ? 'success' : 'warning')}</div>
        </div>`;
        
        let contentHtml = '', performanceHtml = '', a11yHtml = '';
        if (seo.contentAnalysis) {
            const { readabilityScore, internalLinks, externalLinks } = seo.contentAnalysis;
            let readabilityBadge = createBadge('N/A', 'secondary');
            if (readabilityScore !== null) {
                if (readabilityScore >= 60) readabilityBadge = createBadge(readabilityScore, 'success', 'سهل القراءة');
                else if (readabilityScore >= 30) readabilityBadge = createBadge(readabilityScore, 'warning', 'صعب القراءة قليلاً');
                else readabilityBadge = createBadge(readabilityScore, 'danger', 'صعب القراءة جداً');
            }
            contentHtml = `<div class="mt-2 pt-2 border-top border-opacity-10"><strong class="small text-body-secondary d-block mb-1">تحليل المحتوى:</strong>
                <div class="seo-summary-item"><strong>سهولة القراءة:</strong> ${readabilityBadge}</div>
                <div class="seo-summary-item"><strong>روابط داخلية:</strong> ${createBadge(internalLinks, 'info')}</div>
                <div class="seo-summary-item"><strong>روابط خارجية:</strong> ${createBadge(externalLinks, 'info')}</div></div>`;
        }
        if (seo.performance) {
            performanceHtml = `<div class="mt-2 pt-2 border-top border-opacity-10"><strong class="small text-body-secondary d-block mb-1">مقاييس الأداء:</strong>
                <div class="seo-summary-item"><strong>حجم الصفحة:</strong> ${createBadge(`${seo.performance.pageSizeKB} KB`, seo.performance.pageSizeKB > 500 ? 'warning' : 'success')}</div>
                <div class="seo-summary-item" title="JS / CSS / Images"><strong>الموارد:</strong> ${createBadge(`${seo.performance.resourceCounts.js}/${seo.performance.resourceCounts.css}/${seo.performance.resourceCounts.images}`, 'secondary')}</div></div>`;
        }
        if (seo.accessibility) {
            const { formLabels, semanticHeaders, semanticNav, semanticMain } = seo.accessibility;
            const formLabelsBadge = formLabels.total === 0 ? createBadge('لا يوجد', 'secondary') : createBadge(formLabels.missing === 0 ? 'ممتاز' : `${formLabels.missing} خطأ`, formLabels.missing === 0 ? 'success' : 'danger', `${formLabels.missing} عنصر بدون label`);
            const semanticsScore = [semanticHeaders, semanticNav, semanticMain].filter(Boolean).length;
            const semanticsBadge = createBadge(semanticsScore === 3 ? 'ممتاز' : (semanticsScore > 0 ? 'ناقص' : 'مفقود'), semanticsScore === 3 ? 'success' : (semanticsScore > 0 ? 'warning' : 'danger'));
            a11yHtml = `<div class="mt-2 pt-2 border-top border-opacity-10"><strong class="small text-body-secondary d-block mb-1">إمكانية الوصول (a11y):</strong>
                <div class="seo-summary-item"><strong>Labels للنماذج:</strong> ${formLabelsBadge}</div>
                <div class="seo-summary-item"><strong>بنية دلالية:</strong> ${semanticsBadge}</div></div>`;
        }
        return basicSeoHtml + contentHtml + performanceHtml + a11yHtml;
    }

    function displayResults(resultsToShow = null, openAccordionId = null) {
        const results = resultsToShow || appState.searchIndex;
        const hasResults = results.length > 0;
        dom.selectionControls.classList.toggle('d-none', !hasResults);
        dom.exportButtons.classList.toggle('d-none', !hasResults);
        dom.resultsPlaceholder.classList.toggle('d-none', hasResults);
        dom.resultsAccordion.innerHTML = '';
        if (!hasResults) return;
        const grouped = results.reduce((acc, item) => { (acc[item.source || 'unknown'] = acc[item.source || 'unknown'] || []).push(item); return acc; }, {});
        Object.entries(grouped).forEach(([source, items], index) => renderAccordionGroup(source, items, index, openAccordionId));
        updateSelectionUI();
    }
    
    function renderAccordionGroup(source, items, index, openAccordionId = null) {
        const sourceLabels = { 'seo_crawler': `<i class="bi bi-robot ms-2"></i>زاحف SEO`, 'html_analysis': `<i class="bi bi-file-earmark-code-fill ms-2"></i>تحليل HTML`, 'manual': `<i class="bi bi-pencil-fill ms-2"></i>إدخال يدوي`, 'url_generation': `<i class="bi bi-link-45deg ms-2"></i>من الروابط`, 'sitemap': `<i class="bi bi-map-fill ms-2"></i>من Sitemap`, 'robots': `<i class="bi bi-robot ms-2"></i>من robots.txt`, 'spa_analysis': `<i class="bi bi-lightning-charge-fill ms-2"></i>تحليل SPA` };
        const collapseId = `collapse-source-${source.replace(/[^a-zA-Z0-9]/g, '-')}-${index}`;
        const shouldBeOpen = openAccordionId ? (collapseId === openAccordionId) : index === 0;
        const accordionItem = document.createElement('div');
        accordionItem.className = 'accordion-item bg-transparent';
        accordionItem.innerHTML = `<h2 class="accordion-header" id="heading-${collapseId}"><button class="accordion-button ${shouldBeOpen ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">${sourceLabels[source] || source} (${items.length})</button></h2>
            <div id="${collapseId}" class="accordion-collapse collapse ${shouldBeOpen ? 'show' : ''}" data-bs-parent="#resultsAccordion"><div class="accordion-body" data-source="${source}" data-rendered-count="0"></div></div>`;
        dom.resultsAccordion.appendChild(accordionItem);
    }

    function renderItemChunk(container, items, offset) {
        const fragment = document.createDocumentFragment();
        const itemsToRender = items.slice(offset, offset + VIRTUAL_SCROLL_CHUNK_SIZE);
        itemsToRender.forEach(item => {
            const { id, title, url, description, category, tags, seo } = item;
            const itemClone = resultItemTemplate.content.cloneNode(true);
            const seoScore = calculateSeoScore(seo);
            
            const resultItemEl = itemClone.querySelector('.result-item');
            resultItemEl.dataset.id = id;
            resultItemEl.classList.toggle('selected', appState.selectedItemIds.has(id));
            
            const seoDot = itemClone.querySelector('.seo-score-dot');
            seoDot.style.backgroundColor = seoScore.color;
            seoDot.title = `تقييم SEO: ${seoScore.level} (${seoScore.score}/${seoScore.maxScore})`;

            itemClone.querySelector('.item-select-checkbox').checked = appState.selectedItemIds.has(id);
            itemClone.querySelector('.page-title').textContent = title;
            itemClone.querySelector('.no-index-badge').classList.toggle('d-none', !seo?.isNoIndex);
            itemClone.querySelector('.orphan-page-badge').classList.toggle('d-none', !seo?.isOrphan);
            itemClone.querySelector('.orphan-page-prompt').classList.toggle('d-none', !seo?.isOrphan);
            ['preview', 'edit', 'delete'].forEach(action => itemClone.querySelector(`.btn-${action}`).setAttribute('aria-label', `${action}: ${title}`));
            
            itemClone.querySelector('[data-populate="url"]').textContent = url;
            itemClone.querySelector('[data-populate="loadTime"]').textContent = seo?.loadTime ? `${seo.loadTime}ms` : '';
            itemClone.querySelector('[data-field="description"]').textContent = description;
            itemClone.querySelector('[data-field="category"]').textContent = category || '';
            itemClone.querySelector('[data-field="tags"]').textContent = (tags || []).join(', ');
            itemClone.querySelector('.seo-summary-container').innerHTML = renderSeoSummary(seo, id);
            
            fragment.appendChild(itemClone);
        });
        
        container.appendChild(fragment);
        const newRenderedCount = offset + itemsToRender.length;
        container.dataset.renderedCount = newRenderedCount;
        
        if (newRenderedCount < items.length) {
            container.appendChild(Object.assign(document.createElement('button'), {
                className: 'btn btn-outline-secondary btn-sm w-100 mt-2 load-more-btn',
                textContent: 'تحميل المزيد'
            }));
        }
    }

    function handleAccordionShow(event) {
        const accordionBody = event.target.querySelector('.accordion-body');
        if (accordionBody && parseInt(accordionBody.dataset.renderedCount, 10) === 0) {
            const source = accordionBody.dataset.source;
            const items = (appState.filteredResults.length > 0 ? appState.filteredResults : appState.searchIndex).filter(item => (item.source || 'unknown') === source);
            if(items.length > 0) renderItemChunk(accordionBody, items, 0);
        }
    }

    function handleLoadMore(button) {
        const accordionBody = button.closest('.accordion-body');
        if (!accordionBody) return;
        const source = accordionBody.dataset.source;
        const offset = parseInt(accordionBody.dataset.renderedCount, 10);
        const items = (appState.filteredResults.length > 0 ? appState.filteredResults : appState.searchIndex).filter(item => (item.source || 'unknown') === source);
        button.remove();
        renderItemChunk(accordionBody, items, offset);
    }

    function updateAllUI(openAccordionId = null) {
        const results = (dom.keywordFilter.value || dom.categoryFilter.value || dom.orphanFilter.checked) ? appState.filteredResults : appState.searchIndex;
        displayResults(results, openAccordionId);
        
        // This logic ensures the correct accordion group is opened after filtering
        if (openAccordionId && !document.getElementById(openAccordionId)) {
            const firstResult = results[0];
            if (firstResult) {
                const source = firstResult.source || 'unknown';
                const firstGroup = dom.resultsAccordion.querySelector(`[data-source="${source}"]`);
                if(firstGroup) {
                    const collapseElement = firstGroup.closest('.accordion-collapse');
                    if (collapseElement) new bootstrap.Collapse(collapseElement, {show: true});
                }
            }
        } else if (openAccordionId) {
             const accordionBody = dom.resultsAccordion.querySelector(`#${openAccordionId} .accordion-body`);
            if (accordionBody && parseInt(accordionBody.dataset.renderedCount, 10) === 0) {
                const source = accordionBody.dataset.source;
                const items = results.filter(item => (item.source || 'unknown') === source);
                if (items.length > 0) renderItemChunk(accordionBody, items, 0);
            }
        }
        
        updateAnalyticsDashboard(); 
        updateLiveCounter(); 
        updateFilterOptions();
        
        const hasResults = appState.searchIndex.length > 0;
        dom.filterSection.classList.toggle('d-none', !hasResults);
        dom.selectionControls.classList.toggle('d-none', !hasResults || results.length === 0);
        dom.schemaGeneratorSection.classList.toggle('d-none', !hasResults);
    }

    function updateLiveCounter() {
        const count = appState.searchIndex.length;
        dom.liveCounter.classList.toggle('d-none', count === 0);
        if (count > 0) dom.counterValue.textContent = count;
    }

    function renderChart(chartInstance, context, config) {
        if (chartInstance) {
            chartInstance.data.labels = config.data.labels;
            chartInstance.data.datasets = config.data.datasets;
            chartInstance.update();
            return chartInstance;
        }
        return new Chart(context, config);
    }

    function updateAnalyticsDashboard() {
        const hasData = appState.searchIndex && appState.searchIndex.length > 0;
        dom.analyticsDashboard.classList.toggle('d-none', !hasData);
        if (!hasData) {
            if (sourceChartInstance) sourceChartInstance.destroy();
            if (keywordsChartInstance) keywordsChartInstance.destroy();
            if (seoScoreChartInstance) seoScoreChartInstance.destroy();
            sourceChartInstance = keywordsChartInstance = seoScoreChartInstance = null;
            return;
        }

        // Source Distribution Chart
        const sourceCounts = appState.searchIndex.reduce((acc, item) => {
            const source = item.source || 'unknown';
            acc[source] = (acc[source] || 0) + 1;
            return acc;
        }, {});
        const sourceLabelsMap = { 'seo_crawler': `زاحف SEO`, 'html_analysis': `تحليل HTML`, 'manual': `إدخال يدوي`, 'url_generation': `من الروابط`, 'sitemap': `من Sitemap`, 'robots': `من robots.txt`, 'spa_analysis': `تحليل SPA`, 'unknown': 'غير معروف' };
        sourceChartInstance = renderChart(sourceChartInstance, dom.sourceDistributionChart.getContext('2d'), {
            type: 'pie',
            data: {
                labels: Object.keys(sourceCounts).map(l => sourceLabelsMap[l] || l),
                datasets: [{ label: 'عدد الصفحات', data: Object.values(sourceCounts), backgroundColor: ['#4bc0c0', '#ff6384', '#ffcd56', '#36a2eb', '#9966ff', '#c9cbcf', '#ff9f40'] }]
            },
            options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'rgba(255, 255, 255, 0.85)' : '#495057', boxWidth: 12, padding: 15 } } } }
        });

        // Top Keywords Chart
        const allKeywords = appState.searchIndex.flatMap(item => item.tags || []);
        const keywordCount = allKeywords.reduce((acc, keyword) => {
            if (keyword) acc[keyword] = (acc[keyword] || 0) + 1;
            return acc;
        }, {});
        const sortedKeywords = Object.entries(keywordCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
        keywordsChartInstance = renderChart(keywordsChartInstance, dom.topKeywordsChart.getContext('2d'), {
            type: 'bar',
            data: {
                labels: sortedKeywords.map(e => e[0]),
                datasets: [{ label: 'عدد التكرارات', data: sortedKeywords.map(e => e[1]), backgroundColor: 'rgba(75, 192, 192, 0.6)' }]
            },
            options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'rgba(255, 255, 255, 0.85)' : '#495057' } }, y: { ticks: { color: document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'rgba(255, 255, 255, 0.85)' : '#495057' } } } }
        });

        // Average SEO Score Chart
        let totalScore = 0, maxPossibleScore = 0;
        appState.searchIndex.forEach(item => {
            const { score, maxScore } = calculateSeoScore(item.seo);
            totalScore += score;
            maxPossibleScore += maxScore;
        });
        const avgPercentage = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;
        dom.seoScoreText.textContent = `${Math.round(avgPercentage)}%`;
        const scoreColor = avgPercentage >= 80 ? '#4bc0c0' : avgPercentage >= 50 ? '#ffcd56' : '#ff6384';
        seoScoreChartInstance = renderChart(seoScoreChartInstance, dom.averageSeoScoreChart.getContext('2d'), {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [avgPercentage, 100 - avgPercentage],
                    backgroundColor: [scoreColor, 'rgba(255, 255, 255, 0.2)'],
                    circumference: 180, rotation: 270, cutout: '75%'
                }]
            },
            options: { responsive: true, maintainAspectRatio: true, plugins: { tooltip: { enabled: false } } }
        });
        
        // Orphan Pages Report Card
        const orphanCount = appState.searchIndex.filter(item => item.seo?.isOrphan).length;
        dom.orphanPagesCard.classList.toggle('d-none', orphanCount === 0);
        if(orphanCount > 0) {
            dom.orphanPagesCount.textContent = orphanCount;
        }
    }

    function setupFilters() { dom.categoryFilter.addEventListener('change', applyFilters); dom.keywordFilter.addEventListener('input', applyFilters); dom.orphanFilter.addEventListener('change', applyFilters); }

    function updateFilterOptions() {
        const currentCategory = dom.categoryFilter.value;
        const categories = [...new Set(appState.searchIndex.map(item => item.category).filter(Boolean))].sort();
        dom.categoryFilter.innerHTML = '<option value="">جميع الفئات</option>';
        categories.forEach(cat => dom.categoryFilter.add(new Option(cat, cat, false, cat === currentCategory)));
    }

    function applyFilters() {
        const openAccordionId = dom.resultsAccordion.querySelector('.accordion-collapse.show')?.id;
        const categoryFilter = dom.categoryFilter.value;
        const keywordFilter = dom.keywordFilter.value.toLowerCase();
        const orphanFilter = dom.orphanFilter.checked;

        appState.filteredResults = appState.searchIndex.filter(item => 
            (!categoryFilter || item.category === categoryFilter) &&
            (!keywordFilter || (item.title + item.description + (item.tags || []).join(' ')).toLowerCase().includes(keywordFilter)) &&
            (!orphanFilter || item.seo?.isOrphan)
        );
        updateAllUI(openAccordionId);
    }
    
    function updateSelectionUI() {
        document.querySelectorAll('.result-item').forEach(itemDiv => {
            const isSelected = appState.selectedItemIds.has(parseInt(itemDiv.dataset.id, 10));
            itemDiv.classList.toggle('selected', isSelected);
            const checkbox = itemDiv.querySelector('.item-select-checkbox');
            if (checkbox) checkbox.checked = isSelected;
        });
        dom.selectionCounter.textContent = appState.selectedItemIds.size;
    }

    function toggleItemSelection(checkbox, itemId) {
        appState.selectedItemIds[checkbox.checked ? 'add' : 'delete'](itemId);
        updateSelectionUI();
    }
    
    function selectAllItems() {
        const itemsToSelect = (dom.keywordFilter.value || dom.categoryFilter.value || dom.orphanFilter.checked) ? appState.filteredResults : appState.searchIndex;
        itemsToSelect.forEach(item => appState.selectedItemIds.add(item.id));
        updateSelectionUI();
    }

    function deselectAllItems() {
        const itemsToDeselect = new Set(((dom.keywordFilter.value || dom.categoryFilter.value || dom.orphanFilter.checked) ? appState.filteredResults : appState.searchIndex).map(i => i.id));
        appState.selectedItemIds = new Set([...appState.selectedItemIds].filter(id => !itemsToDeselect.has(id)));
        updateSelectionUI();
    }

    function getSelectedItems() {
        const activeFilters = dom.keywordFilter.value || dom.categoryFilter.value || dom.orphanFilter.checked;
        const baseList = activeFilters ? appState.filteredResults : appState.searchIndex;
        
        return appState.selectedItemIds.size === 0 
            ? baseList
            : appState.searchIndex.filter(item => appState.selectedItemIds.has(item.id));
    }

    const getStrippedIndex = (items) => items.map(({ id, title, description, url, category, tags, seo }) => ({ id, title, description, url, category, tags, seo }));
    const downloadFile = (blob, filename) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href); };
    
    function downloadJson() {
        const items = getSelectedItems();
        if (items.length === 0) return showNotification('لا توجد عناصر للتصدير', 'warning');
        downloadFile(new Blob([JSON.stringify(getStrippedIndex(items), null, 2)], { type: 'application/json' }), 'search-index.json');
        showNotification(`تم تحميل ${items.length} عنصر كـ JSON <i class="bi bi-filetype-json ms-2"></i>`, 'success');
    }

    function downloadCSV() {
        const items = getSelectedItems();
        if (items.length === 0) return showNotification('لا توجد عناصر للتصدير', 'warning');
        const csv = ['ID,العنوان,الرابط,الوصف,الفئة,الكلمات المفتاحية', ...items.map(i => [`"${i.id}"`, `"${i.title.replace(/"/g, '""')}"`, `"${i.url}"`, `"${i.description.replace(/"/g, '""')}"`, `"${i.category || ''}"`, `"${(i.tags || []).join(', ')}"`].join(','))].join('\n');
        downloadFile(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }), 'search-index.csv');
        showNotification(`تم تحميل ${items.length} عنصر كـ CSV <i class="bi bi-filetype-csv ms-2"></i>`, 'success');
    }

    async function downloadZip() {
        const items = getSelectedItems();
        if (items.length === 0) return showNotification('لا توجد عناصر للتصدير', 'warning');
        dom.zipProgress.classList.remove('d-none');
        try {
            const zip = new JSZip();
            zip.file('search-index.json', JSON.stringify(getStrippedIndex(items), null, 2));
            const selectedUrls = new Set(items.map(item => item.url));
            const htmlFiles = appState.analyzedFiles.filter(f => f.content && selectedUrls.has(f.url));
            if (htmlFiles.length > 0) { const htmlFolder = zip.folder('html-files'); htmlFiles.forEach(f => htmlFolder.file(f.filename, f.content)); }
            const content = await zip.generateAsync({ type: 'blob' }, (metadata) => { dom.zipProgressBar.style.width = `${metadata.percent.toFixed(2)}%`; });
            downloadFile(content, 'search-index-package.zip');
            showNotification(`تم تحميل ${items.length} عنصر في حزمة ZIP <i class="bi bi-file-zip-fill ms-2"></i>`, 'success');
        } catch (error) { showNotification('خطأ في إنشاء ZIP: ' + error.message, 'danger'); } finally { setTimeout(() => dom.zipProgress.classList.add('d-none'), 2000); }
    }

    function copyToClipboard(type) {
        const items = getSelectedItems();
        if (items.length === 0) return showNotification('لا توجد عناصر للنسخ', 'warning');
        const dataMap = { all: () => JSON.stringify(getStrippedIndex(items), null, 2), titles: () => items.map(i => i.title).join('\n'), urls: () => items.map(i => i.url).join('\n'), descriptions: () => items.map(i => i.description).join('\n') };
        navigator.clipboard.writeText(dataMap[type]()).then(() => {
            showNotification(`تم نسخ بيانات ${items.length} عنصر إلى الحافظة! <i class="bi bi-clipboard-check-fill ms-2"></i>`, 'success');
            dom.copyOptions.classList.add('d-none');
        }).catch(err => showNotification('فشل النسخ!', 'danger'));
    }

    const getProjectStorageKey = (name) => `searchIndexGenerator_${name}`;
    function getProjectList() { try { return JSON.parse(localStorage.getItem(PROJECTS_MASTER_KEY)) || []; } catch { return []; } }

    function updateProjectListDropdown() {
        const current = dom.projectNameInput.value;
        dom.projectSelector.innerHTML = '<option value="">-- اختر مشروعًا --</option>';
        getProjectList().forEach(p => dom.projectSelector.add(new Option(p, p, false, p === current)));
    }

    function clearCurrentState() {
        Object.assign(appState, { searchIndex: [], manualPages: [], analyzedFiles: [], sitemapUrls: [], robotsUrls: [], manifestData: {}, filteredResults: [], schemaConfig: { baseUrl: '', pageSchemaType: 'WebPage', baseSchema: DEFAULT_BASE_SCHEMA_STR } });
        appState.selectedItemIds.clear();
        ['urlInput', 'customProxyUrl', 'projectNameInput', 'projectSelector', 'schemaBaseUrl'].forEach(id => getEl(id).value = '');
        dom.orphanFilter.checked = false;
        dom.keywordFilter.value = '';
        dom.categoryFilter.value = '';
        dom.schemaPageType.value = 'WebPage';
        dom.schemaBaseEditor.value = appState.schemaConfig.baseSchema;
        validateSchemaEditor();
        updateAllUI();
    }

    function loadProject(name) {
        if (!name) { clearCurrentState(); return; }
        try {
            const saved = localStorage.getItem(getProjectStorageKey(name));
            if (saved) {
                const data = JSON.parse(saved);
                const defaultConfig = { baseUrl: '', pageSchemaType: 'WebPage', baseSchema: DEFAULT_BASE_SCHEMA_STR };
                Object.assign(appState, { ...data, selectedItemIds: new Set(), schemaConfig: { ...defaultConfig, ...data.schemaConfig } });
                dom.urlInput.value = data.urlInput || '';
                dom.customProxyUrl.value = data.customProxyUrl || '';
                dom.projectNameInput.value = name;
                dom.orphanFilter.checked = false;
                dom.schemaBaseUrl.value = appState.schemaConfig.baseUrl;
                dom.schemaPageType.value = appState.schemaConfig.pageSchemaType;
                dom.schemaBaseEditor.value = appState.schemaConfig.baseSchema;
                validateSchemaEditor();
                localStorage.setItem(LAST_PROJECT_KEY, name);
                applyFilters(); // Apply empty filters to reset view
                updateProjectListDropdown();
                showNotification(`تم تحميل مشروع "${name}"! <i class="bi bi-folder2-open ms-2"></i>`, 'info');
            }
        } catch (e) { showNotification('خطأ في تحميل المشروع: ' + e.message, 'warning'); }
    }
    
    function debouncedSaveProject() { clearTimeout(saveTimeout); saveTimeout = setTimeout(saveProject, 1000); }
    
    function saveProject() {
        const name = dom.projectNameInput.value.trim();
        if (!name) return;
        const dataToSave = { ...appState, analyzedFiles: appState.analyzedFiles.map(({ content, ...rest }) => rest), urlInput: dom.urlInput.value, customProxyUrl: dom.customProxyUrl.value, timestamp: new Date().toISOString() };
        try {
            localStorage.setItem(getProjectStorageKey(name), JSON.stringify(dataToSave));
            const projects = getProjectList();
            if (!projects.includes(name)) { projects.push(name); localStorage.setItem(PROJECTS_MASTER_KEY, JSON.stringify(projects)); }
            localStorage.setItem(LAST_PROJECT_KEY, name);
            updateProjectListDropdown();
        } catch (e) { showNotification('خطأ في حفظ البيانات: ' + e.message, 'danger'); }
    }

    function handleManualSave() {
        const name = dom.projectNameInput.value.trim();
        if (!name) return showNotification('يرجى إدخال اسم للمشروع.', 'warning');
        if (validateSchemaEditor()) appState.schemaConfig.baseSchema = dom.schemaBaseEditor.value;
        else showNotification('تم حفظ المشروع، لكن "السكيما الأساسية" تحتوي على أخطاء.', 'warning', 6000);
        appState.schemaConfig.baseUrl = dom.schemaBaseUrl.value.trim();
        appState.schemaConfig.pageSchemaType = dom.schemaPageType.value;
        saveProject();
        showNotification(`تم حفظ المشروع "${name}"! <i class="bi bi-save-fill ms-2"></i>`, 'success');
    }

    function deleteSelectedProject() {
        const name = dom.projectSelector.value;
        if (!name) return showNotification('يرجى اختيار مشروع لحذفه.', 'warning');
        if (confirm(`هل أنت متأكد من حذف المشروع "${name}"؟`)) {
            localStorage.removeItem(getProjectStorageKey(name));
            localStorage.setItem(PROJECTS_MASTER_KEY, JSON.stringify(getProjectList().filter(p => p !== name)));
            if (dom.projectNameInput.value === name) clearCurrentState();
            updateProjectListDropdown();
            showNotification(`تم حذف المشروع "${name}"!`, 'success');
        }
    }

    function loadLastProject() { const last = localStorage.getItem(LAST_PROJECT_KEY); if (last) loadProject(last); else validateSchemaEditor(); }

    async function processHtmlFiles(files) {
        let newFilesAnalyzed = 0;
        for (const file of files) {
            if (!appState.analyzedFiles.some(f => f.filename === file.name)) {
                try {
                    const analysis = analyzeHtmlContent(await readFileContent(file), file.name);
                    appState.analyzedFiles.push(analysis); newFilesAnalyzed++;
                } catch (e) { console.error('Error processing file:', file.name, e); showNotification(`خطأ في معالجة ${file.name}`, 'danger'); }
            }
        }
        if (newFilesAnalyzed > 0) { showNotification(`تم تحليل ${newFilesAnalyzed} ملف HTML جديد!`, 'success'); debouncedSaveProject(); }
        else showNotification('جميع الملفات تم تحليلها مسبقاً', 'info');
    }

    function toggleCopyOptions() { dom.copyOptions.classList.toggle('d-none'); }

    async function analyzeSpaSite() {
        const url = dom.spaUrl.value.trim();
        if (!url) return showNotification('يرجى إدخال رابط الموقع للتحليل', 'warning');
        showNotification(`🔬 جاري تحليل ${url}...`, 'info');
        try {
            const response = await fetch(getProxyUrl(url));
            if (!response.ok) throw new Error(`Status: ${response.status}`);
            const analysis = analyzeHtmlContent(await response.text(), url);
            const added = addItemsToIndex([{ ...analysis, category: 'تحليل SPA', source: 'spa_analysis' }]);
            if (added > 0) { showNotification(`✅ تم تحليل الموقع وإضافته للنتائج.`, 'success'); updateAllUI(); debouncedSaveProject(); } 
            else showNotification('تم تحليل هذا الموقع مسبقاً.', 'info');
        } catch (e) { console.error('SPA Error:', e); showNotification(`خطأ في تحليل الموقع: ${e.message}`, 'danger'); }
    }

    async function processTextualFile(file, urlExtractor, successMsg, noDataMsg, errorMsg) {
        try {
            const urls = urlExtractor(await readFileContent(file));
            if (urls.length > 0) {
                dom.urlInput.value += (dom.urlInput.value ? '\n' : '') + urls.join('\n');
                showNotification(successMsg(urls.length), 'success');
                debouncedSaveProject();
            } else showNotification(noDataMsg, 'warning');
        } catch (e) { showNotification(errorMsg(e.message), 'danger'); }
    }

    function showNotification(message, type = 'info', duration = 5000) {
        const container = document.querySelector('.toast-container');
        const colors = { info: 'bg-info text-white', success: 'bg-success text-white', warning: 'bg-warning text-dark', danger: 'bg-danger text-white' };
        const toast = Object.assign(document.createElement('div'), {
            id: 'toast-' + Date.now(),
            className: `toast align-items-center ${colors[type]} border-0`,
            role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true'
        });
        toast.innerHTML = `<div class="d-flex align-items-center"><div class="toast-body flex-grow-1">${message}</div><button type="button" class="btn-close ${type === 'warning' ? 'btn-close-dark' : 'btn-close-white'} ms-2" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
        container.appendChild(toast);
        const bsToast = new bootstrap.Toast(toast, { delay: duration }); bsToast.show();
        toast.addEventListener('hidden.bs.toast', () => toast.remove());
    }

    function readFileContent(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = e => resolve(e.target.result); reader.onerror = reject; reader.readAsText(file); }); }

    function extractTagsFromUrl(url) {
        if (!url) return [];
        try {
            const path = new URL(url, url.startsWith('http') ? undefined : 'http://dummy.com').pathname;
            const parts = path.split('/').filter(Boolean);
            const tags = parts.flatMap(p => p.replace(/\.[^/.]+$/, '').split(/[-_\s]+/)).filter(p => p.length > 2);
            const translations = { 'index': 'الرئيسية', 'home': 'الرئيسية', 'about': 'من نحن', 'contact': 'اتصل بنا', 'services': 'خدمات', 'products': 'منتجات', 'blog': 'مدونة', 'news': 'أخبار', 'portfolio': 'أعمال', 'team': 'فريق', 'pricing': 'أسعار', 'faq': 'أسئلة شائعة' };
            tags.forEach(tag => { if (translations[tag.toLowerCase()]) tags.push(translations[tag.toLowerCase()]); });
            return [...new Set(tags.map(t => t.toLowerCase()))];
        } catch (e) { console.error("URL tag extraction failed:", url, e); return []; }
    }

    function importUrlsFile() { const file = dom.urlsFileInput.files[0]; if (file) processDroppedTextFiles([file]); else showNotification('يرجى اختيار ملف أولاً', 'warning'); }

    function addManualPage() {
        const title = getEl('pageTitle').value, url = getEl('pageUrl').value;
        if (!title || !url) return showNotification('يرجى إدخال العنوان والرابط على الأقل', 'warning');
        appState.manualPages.push({ title, url: url.startsWith('/') ? url : '/' + url, description: getEl('pageDescription').value, category: getEl('pageCategory').value || 'عام', tags: getEl('pageTags').value.split(',').map(t => t.trim()).filter(Boolean) });
        ['pageTitle', 'pageUrl', 'pageDescription', 'pageCategory', 'pageTags'].forEach(id => getEl(id).value = '');
        showNotification(`تم إضافة: ${title} يدويًا. اضغط "توليد" لإظهارها.`, 'success');
        debouncedSaveProject();
    }

    function enterEditMode(item, pageItem, editBtn) {
        pageItem.classList.add('is-editing');
        pageItem.querySelectorAll('.editable-content').forEach((el, index) => {
            const field = el.dataset.field;
            const input = field === 'description' ? document.createElement('textarea') : document.createElement('input');
            if(field === 'description') input.rows = 3; else input.type = 'text';
            Object.assign(input, { className: 'form-control form-control-sm edit-input', value: Array.isArray(item[field]) ? item[field].join(', ') : item[field] });
            Object.assign(input.dataset, { editField: field, originalTag: el.tagName.toLowerCase(), originalClasses: el.className });
            el.replaceWith(input);
            if (index === 0) input.focus();
        });
        editBtn.innerHTML = 'حفظ';
        editBtn.classList.replace('btn-outline-secondary', 'btn-success');
    }

    function saveEditMode(item, pageItem, editBtn) {
        const titleInput = pageItem.querySelector('[data-edit-field="title"]');
        if (!titleInput.value.trim()) {
            return showNotification('حقل العنوان لا يمكن أن يكون فارغاً!', 'danger');
        }

        pageItem.querySelectorAll('[data-edit-field]').forEach(input => {
            const field = input.dataset.editField;
            const value = input.value.trim();
            item[field] = field === 'tags' ? value.split(',').map(t => t.trim()).filter(Boolean) : value;
            const staticEl = document.createElement(input.dataset.originalTag);
            Object.assign(staticEl, { className: input.dataset.originalClasses, textContent: value });
            staticEl.dataset.field = field;
            input.replaceWith(staticEl);
        });

        pageItem.classList.remove('is-editing');
        editBtn.innerHTML = 'تحرير';
        editBtn.classList.replace('btn-success', 'btn-outline-secondary');
        showNotification('تم حفظ التعديلات!', 'success');
        updateAnalyticsDashboard();
        debouncedSaveProject();
    }

    function toggleEdit(itemId) {
        const pageItem = document.querySelector(`.result-item[data-id="${itemId}"]`);
        if (!pageItem) return;
        const editBtn = pageItem.querySelector('.btn-edit');
        const item = appState.searchIndex.find(i => i.id === itemId);
        if (!item) return;

        if (pageItem.classList.contains('is-editing')) saveEditMode(item, pageItem, editBtn);
        else { enterEditMode(item, pageItem, editBtn); showSerpPreview(itemId); }
    }

    function deleteItem(itemId) {
        const item = appState.searchIndex.find(i => i.id === itemId);
        if (!item) return;
        if (confirm(`هل أنت متأكد من حذف العنصر:\n"${item.title}"`)) {
            appState.searchIndex = appState.searchIndex.filter(i => i.id !== itemId);
            appState.filteredResults = appState.filteredResults.filter(i => i.id !== itemId);
            appState.selectedItemIds.delete(itemId);
            applyFilters(); // Re-apply filters to refresh the view
            showNotification(`تم حذف العنصر بنجاح!`, 'success');
            debouncedSaveProject();
        }
    }

    function showSerpPreview(itemId) {
        const item = appState.searchIndex.find(i => i.id === itemId);
        if (!item) return;
        getEl('previewUrl').textContent = item.url; getEl('previewTitle').textContent = item.title;
        getEl('previewDescription').textContent = item.description; getEl('titleCharCount').textContent = item.title.length;
        getEl('descCharCount').textContent = item.description.length;
    }

    function validateSchemaEditor() {
        const editor = dom.schemaBaseEditor;
        try { JSON.parse(editor.value); editor.classList.remove('is-invalid'); editor.classList.add('is-valid'); return true; } 
        catch { editor.classList.remove('is-valid'); editor.classList.add('is-invalid'); return false; }
    }
    
    function validateAndCommitSchemaConfig() {
        appState.schemaConfig.baseUrl = dom.schemaBaseUrl.value.trim();
        appState.schemaConfig.pageSchemaType = dom.schemaPageType.value;
        if (validateSchemaEditor()) {
            appState.schemaConfig.baseSchema = dom.schemaBaseEditor.value; return true;
        }
        showNotification('يرجى تصحيح الأخطاء في "السكيما الأساسية" قبل المتابعة.', 'danger');
        dom.schemaBaseEditor.focus();
        return false;
    }

    function sanitizeForFilename(url) {
        return (url.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').replace(/\/$/, '').replace(/\//g, '_').replace(/[?&#=:%]/g, '-').replace(/\.html?$/, '') || 'index');
    }

    async function generateAndDownloadSchema() {
        if (!validateAndCommitSchemaConfig()) return;
        const { baseUrl, pageSchemaType, baseSchema } = appState.schemaConfig;
        if (!baseUrl) return showNotification('يرجى إدخال رابط الموقع الأساسي.', 'warning');
        const items = getSelectedItems();
        if (items.length === 0) {
            showNotification('<strong>خطوة ناقصة:</strong> يجب أولاً توليد قائمة بالصفحات.', 'warning', 7000);
            dom.results.classList.add('border', 'border-warning', 'border-3', 'shadow');
            setTimeout(() => dom.results.classList.remove('border', 'border-warning', 'border-3', 'shadow'), 2500);
            return;
        }

        const zip = new JSZip();
        try {
            const baseSchemaObject = JSON.parse(baseSchema);
            baseSchemaObject.url = baseUrl; baseSchemaObject['@id'] = new URL('#website', baseUrl).href;
            zip.file('_schema_base.jsonld', JSON.stringify(baseSchemaObject, null, 2));

            const publisherName = baseSchemaObject.name || "Your Organization Name";
            const publisherLogoUrl = baseSchemaObject.logo || new URL("/logo.png", baseUrl).href;

            for (const item of items) {
                const pageUrl = new URL(item.url, baseUrl).href;
                const pageSchema = { "@context": "https://schema.org", "@type": pageSchemaType, "@id": pageUrl, name: item.title, headline: item.title, description: item.description, url: pageUrl, isPartOf: { "@id": baseSchemaObject['@id'] }, primaryImageOfPage: { "@type": "ImageObject", url: (item.seo?.ogImage) ? new URL(item.seo.ogImage, baseUrl).href : new URL('/og-image.png', baseUrl).href }, datePublished: new Date().toISOString().split('T')[0], dateModified: new Date().toISOString().split('T')[0] };
                if (['Article', 'Product', 'Service'].includes(pageSchemaType)) {
                    pageSchema.author = { "@type": "Organization", name: publisherName };
                    pageSchema.publisher = { "@type": "Organization", name: publisherName, logo: { "@type": "ImageObject", url: publisherLogoUrl } };
                }
                zip.file(`${sanitizeForFilename(item.url)}.jsonld`, JSON.stringify(pageSchema, null, 2));
            }
            const content = await zip.generateAsync({ type: 'blob' });
            downloadFile(content, 'schema_package.zip');
            showNotification(`تم توليد حزمة سكيما لـ ${items.length} صفحة!`, 'success');
        } catch (e) { showNotification(`فشل في إنشاء حزمة السكيما: ${e.message}`, 'danger'); }
    }

    function init() {
        const domIds = ['darkModeToggle', 'liveCounter', 'counterValue', 'seoCrawlerUrl', 'seoCrawlerDepth', 'customProxyUrl', 'spaUrl', 'urlInput', 'manualInput', 'manualInputSection', 'projectSelector', 'projectNameInput', 'analyticsDashboard', 'sourceDistributionChart', 'topKeywordsChart', 'averageSeoScoreChart', 'seoScoreText', 'orphanPagesCard', 'orphanPagesCount', 'viewOrphanPagesBtn', 'filterSection', 'categoryFilter', 'keywordFilter', 'orphanFilter', 'selectionControls', 'selectionCounter', 'results', 'resultsAccordion', 'resultsPlaceholder', 'exportButtons', 'zipProgress', 'zipProgressBar', 'copyOptions', 'schemaGeneratorSection', 'schemaBaseUrl', 'schemaPageType', 'schemaBaseEditor', 'crawlerStatus', 'crawlerCurrentUrl', 'crawlerProgressBar', 'crawlerProgressText', 'crawlerQueueCount', 'urlsFileInput'];
        domIds.forEach(id => dom[id] = getEl(id));
        resultItemTemplate = getEl('resultItemTemplate');
        
        const initialDarkMode = localStorage.getItem('darkMode') === 'true' || (localStorage.getItem('darkMode') === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
        setDarkMode(initialDarkMode);
        
        updateProjectListDropdown();
        loadLastProject();

        const listeners = {
            'darkModeToggle': { 'click': toggleDarkMode },
            'startCrawlerBtn': { 'click': startSeoCrawler },
            'analyzeSpaBtn': { 'click': analyzeSpaSite },
            'importUrlsFileBtn': { 'click': importUrlsFile },
            'addManualPageBtn': { 'click': addManualPage },
            'generateIndexBtn': { 'click': handleGenerateClick },
            'selectAllBtn': { 'click': selectAllItems },
            'deselectAllBtn': { 'click': deselectAllItems },
            'downloadJsonBtn': { 'click': downloadJson },
            'downloadCsvBtn': { 'click': downloadCSV },
            'downloadZipBtn': { 'click': downloadZip },
            'toggleCopyBtn': { 'click': toggleCopyOptions },
            'saveProjectBtn': { 'click': handleManualSave },
            'projectSelector': { 'change': (e) => loadProject(e.target.value) },
            'deleteProjectBtn': { 'click': deleteSelectedProject },
            'clearFormBtn': { 'click': () => { if (confirm('هل أنت متأكد من مسح جميع البيانات الحالية؟')) { clearCurrentState(); showNotification('تم مسح كل شيء.', 'info'); } } },
            'manualInput': { 'change': (e) => dom.manualInputSection.classList.toggle('d-none', !e.target.checked) },
            'hideCrawlerStatusBtn': { 'click': () => dom.crawlerStatus.classList.add('d-none') },
            'generateSchemaBtn': { 'click': generateAndDownloadSchema },
            'schemaBaseUrl': { 'change': () => { appState.schemaConfig.baseUrl = dom.schemaBaseUrl.value.trim(); debouncedSaveProject(); } },
            'schemaPageType': { 'change': () => { appState.schemaConfig.pageSchemaType = dom.schemaPageType.value; debouncedSaveProject(); } },
            'schemaBaseEditor': { 'input': validateSchemaEditor, 'blur': () => { if (validateSchemaEditor()) { appState.schemaConfig.baseSchema = dom.schemaBaseEditor.value; debouncedSaveProject(); } } },
            'viewOrphanPagesBtn': { 'click': () => { dom.orphanFilter.checked = true; applyFilters(); dom.results.scrollIntoView({ behavior: 'smooth' }); } }
        };
        
        for (const id in listeners) {
            for (const event in listeners[id]) {
                getEl(id)?.addEventListener(event, listeners[id][event]);
            }
        }

        dom.results.addEventListener('click', (e) => {
            const target = e.target.closest('button, .item-select-checkbox');
            if (!target) return;
            const resultItem = target.closest('.result-item');
            if (target.classList.contains('load-more-btn')) return handleLoadMore(target);
            if (!resultItem) return;

            const itemId = parseInt(resultItem.dataset.id, 10);
            const actions = {
                'btn-edit': () => toggleEdit(itemId), 'btn-preview': () => showSerpPreview(itemId),
                'btn-delete': () => deleteItem(itemId), 'item-select-checkbox': () => toggleItemSelection(target, itemId)
            };
            for (const className in actions) {
                if (target.classList.contains(className)) return actions[className]();
            }
        });
        
        dom.resultsAccordion.addEventListener('show.bs.collapse', handleAccordionShow);
        if (dom.copyOptions) dom.copyOptions.addEventListener('click', e => { const btn = e.target.closest('button[data-copy-type]'); if (btn) copyToClipboard(btn.dataset.copyType); });

        const setupDragDrop = (dropZoneId, fileInputId, fileTypeRegex, processFunction) => {
            const dropZone = getEl(dropZoneId); const fileInput = getEl(fileInputId); if (!dropZone || !fileInput) return;
            dropZone.addEventListener('click', () => fileInput.click());
            ['dragover', 'dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, e => {
                e.preventDefault(); e.stopPropagation();
                dropZone.classList.toggle('dragover', eventName === 'dragover');
                if (eventName === 'drop') {
                    const files = [...e.dataTransfer.files].filter(f => fileTypeRegex.test(f.name));
                    if (files.length > 0) processFunction(fileInput.multiple ? files : files[0]);
                }
            }));
            fileInput.addEventListener('change', (e) => { if (e.target.files.length > 0) processFunction(fileInput.multiple ? [...e.target.files] : e.target.files[0]); });
        };

        const textualFileHandler = (extractor, success, noData, error) => file => processTextualFile(file, extractor, success, noData, error);
        
        setupDragDrop('robotsDropZone', 'robotsFileInput', /\.txt$/, textualFileHandler(c => c.split('\n').filter(l => /^(dis)?allow:/i.test(l.trim())).map(l => l.split(':')[1]?.trim()).filter(Boolean), len => `تم استخراج ${len} مسار من robots.txt!`, 'لم يتم العثور على مسارات.', e => `خطأ: ${e}`));
        setupDragDrop('manifestDropZone', 'manifestFileInput', /\.json$/, textualFileHandler(c => { const d = JSON.parse(c); return [...(d.icons?.map(i => i.src) || []), ...(d.screenshots?.map(s => s.src) || []), d.start_url, ...(d.shortcuts?.map(s => s.url) || [])].filter(Boolean); }, len => `تم استخراج ${len} مسار من manifest.json!`, 'لم يتم العثور على مسارات.', e => `خطأ: ${e}`));
        setupDragDrop('sitemapDropZone', 'sitemapFileInput', /\.xml$/, textualFileHandler(c => { const d = new DOMParser().parseFromString(c, 'text/xml'); if (d.querySelector('parsererror')) throw new Error('XML غير صالح'); return [...d.querySelectorAll('url > loc, sitemap > loc')].map(el => { try { return new URL(el.textContent.trim()).pathname; } catch { return el.textContent.trim(); } }).filter(Boolean); }, len => `تم استخراج ${len} رابط من Sitemap!`, 'لم يتم العثور على روابط.', e => `خطأ: ${e}`));
        setupDragDrop('fileDropZone', 'htmlFileInput', /\.html?$/, processHtmlFiles);
        
        setupFilters();
    }

    window.addEventListener('DOMContentLoaded', init);

})();