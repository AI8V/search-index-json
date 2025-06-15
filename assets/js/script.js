(function () { // Start of IIFE to encapsulate code
    // --- Centralized Application State ---
    const DEFAULT_BASE_SCHEMA_OBJ = {
        "@context": "https://schema.org",
        "@type": ["WebSite", "Organization"],
        "@id": "https://example.com/#website",
        "name": "Your Organization Name",
        "url": "https://example.com",
        "logo": "https://example.com/logo.png",
        "sameAs": [
            "https://www.facebook.com/your-profile",
            "https://twitter.com/your-profile"
        ],
        "potentialAction": {
            "@type": "SearchAction",
            "target": {
                "@type": "EntryPoint",
                "urlTemplate": "https://example.com/search?q={search_term_string}"
            },
            "query-input": "required name=search_term_string"
        }
    };
    const DEFAULT_BASE_SCHEMA_STR = JSON.stringify(DEFAULT_BASE_SCHEMA_OBJ, null, 2);

    const appState = {
        searchIndex: [],
        manualPages: [],
        analyzedFiles: [],
        sitemapUrls: [],
        robotsUrls: [],
        manifestData: {},
        filteredResults: [],
        selectedItemIds: new Set(),
        schemaConfig: {
            baseUrl: '',
            pageSchemaType: 'WebPage',
            baseSchema: DEFAULT_BASE_SCHEMA_STR
        }
    };
    
    // --- Constants ---
    const PROJECTS_MASTER_KEY = 'searchIndexGenerator_projects';
    const LAST_PROJECT_KEY = 'searchIndexGenerator_lastProject';
    const VIRTUAL_SCROLL_CHUNK_SIZE = 15; // Number of items to render at a time

    // --- State & Variables ---
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    let isDarkMode = localStorage.getItem('darkMode') === 'true' || (localStorage.getItem('darkMode') === null && prefersDark);
    const dom = {};
    let resultItemTemplate; // To be populated on DOMContentLoaded
    let saveTimeout;
    let sourceChartInstance, keywordsChartInstance, seoScoreChartInstance;

    // --- Core Functions ---
    const getEl = (id) => document.getElementById(id);

    function setDarkMode(isDark) {
        isDarkMode = isDark;
        localStorage.setItem('darkMode', isDarkMode);
        document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
        updateDarkModeButton();
    }

    function toggleDarkMode() {
        setDarkMode(!isDarkMode);
        const icon = isDarkMode ? `<i class="bi bi-moon-stars-fill ms-2" aria-hidden="true"></i>` : `<i class="bi bi-sun-fill ms-2" aria-hidden="true"></i>`;
        showNotification(`${icon} تم تفعيل الوضع ${isDarkMode ? 'الليلي' : 'النهاري'}`, 'info');
    }

    function updateDarkModeButton() {
        if (isDarkMode) {
            dom.darkModeToggle.innerHTML = `<i class="bi bi-sun-fill" aria-hidden="true"></i> <span class="d-none d-sm-inline">الوضع النهاري</span>`;
        } else {
            dom.darkModeToggle.innerHTML = `<i class="bi bi-moon-stars-fill" aria-hidden="true"></i> <span class="d-none d-sm-inline">الوضع الليلي</span>`;
        }
    }

    function getProxyUrl(targetUrl) {
        const customProxy = dom.customProxyUrl.value.trim();
        if (customProxy) {
            return customProxy.replace('{url}', encodeURIComponent(targetUrl));
        }
        return `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    }

    async function startSeoCrawler() {
        const baseUrlInput = dom.seoCrawlerUrl;
        let baseUrl = baseUrlInput.value.trim();
        if (!baseUrl) { return showNotification('يرجى إدخال رابط الموقع للزحف', 'warning'); }

        try {
            if (!/^https?:\/\//i.test(baseUrl)) { baseUrl = 'https://' + baseUrl; baseUrlInput.value = baseUrl; }
            const parsedUrl = new URL(baseUrl);
            dom.schemaBaseUrl.value = parsedUrl.origin;
            appState.schemaConfig.baseUrl = parsedUrl.origin;
        } catch (e) { return showNotification('رابط الموقع غير صالح', 'danger'); }

        const maxDepth = parseInt(dom.seoCrawlerDepth.value, 10) || 0;
        const origin = new URL(baseUrl).origin;
        showNotification(`<i class="bi bi-rocket-takeoff-fill ms-2" aria-hidden="true"></i> بدء زحف SEO لـ ${origin}...`, 'info');

        dom.crawlerStatus.classList.remove('d-none');

        let queue = [{ url: baseUrl, depth: 0 }];
        const visited = new Set([baseUrl]);
        const crawledData = new Map();
        const brokenLinks = new Set();
        let processedCount = 0;

        const updateCrawlerUI = () => {
            const totalToProcess = processedCount + queue.length;
            const percentage = totalToProcess > 0 ? (processedCount / totalToProcess) * 100 : 0;
            dom.crawlerProgressBar.style.width = `${percentage}%`;
            dom.crawlerProgressText.textContent = `${processedCount}/${totalToProcess}`;
            dom.crawlerQueueCount.textContent = `في الانتظار: ${queue.length}`;
        };

        updateCrawlerUI();

        while (queue.length > 0) {
            await new Promise(r => setTimeout(r, 200));

            const { url, depth } = queue.shift();
            processedCount++;
            dom.crawlerCurrentUrl.textContent = `فحص: ${new URL(url).pathname}...`;
            updateCrawlerUI();

            try {
                const startTime = performance.now();
                const response = await fetch(getProxyUrl(url));
                const loadTime = Math.round(performance.now() - startTime);

                if (!response.ok) throw new Error(`Status ${response.status}`);
                const html = await response.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');

                const analysis = analyzeHtmlContent(html, url, { loadTime });
                const linksOnPage = new Set();
                doc.querySelectorAll('a[href]').forEach(link => {
                    const href = link.getAttribute('href');
                    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
                    try {
                        const absoluteUrl = new URL(href, url).href;
                        linksOnPage.add(absoluteUrl);
                        if (absoluteUrl.startsWith(origin) && !visited.has(absoluteUrl) && depth < maxDepth) {
                            const fileExtension = absoluteUrl.split('.').pop().toLowerCase();
                            const isPage = !['jpg', 'jpeg', 'png', 'gif', 'svg', 'css', 'js', 'pdf', 'zip'].includes(fileExtension);
                            if (isPage) { visited.add(absoluteUrl); queue.push({ url: absoluteUrl, depth: depth + 1 }); }
                        }
                    } catch (e) { /* Ignore invalid URLs */ }
                });
                crawledData.set(url, { analysis, outgoingLinks: [...linksOnPage] });
            } catch (error) {
                console.error(`فشل في جلب ${url}:`, error);
                brokenLinks.add(url);
                showNotification(`<i class="bi bi-exclamation-triangle-fill ms-2" aria-hidden="true"></i> رابط مكسور أو فشل الاتصال: ${new URL(url).pathname}`, 'warning');
            }
            updateCrawlerUI();
        }

        dom.crawlerCurrentUrl.textContent = 'اكتمل الزحف! جاري إضافة النتائج...';
        dom.crawlerProgressBar.style.width = '100%';

        crawledData.forEach((data, pageUrl) => { data.analysis.seo.brokenLinksOnPage = data.outgoingLinks.filter(link => brokenLinks.has(link)); });

        const newItems = Array.from(crawledData.values()).map(({ analysis }) => ({
            title: analysis.title, description: analysis.description, url: analysis.url,
            category: 'زاحف SEO',
            tags: analysis.keywords.length > 0 ? analysis.keywords : extractTagsFromUrl(analysis.url),
            source: 'seo_crawler', seo: analysis.seo
        }));

        const addedCount = addItemsToIndex(newItems);

        if (addedCount > 0) {
            showNotification(`<i class="bi bi-check-circle-fill ms-2" aria-hidden="true"></i> اكتمل الزحف! تمت إضافة ${addedCount} صفحة جديدة.`, 'success');
            updateAllUI();
            debouncedSaveProject();
        } else if (crawledData.size > 0) {
            showNotification('🏁 اكتمل الزحف. جميع الصفحات التي تم العثور عليها موجودة بالفعل.', 'info');
        } else {
            showNotification('❌ فشل الزحف. لم يتم العثور على أي صفحات قابلة للوصول.', 'danger');
        }
        if (brokenLinks.size > 0) { showNotification(`<i class="bi bi-exclamation-octagon-fill ms-2" aria-hidden="true"></i> تم العثور على ${brokenLinks.size} رابط داخلي مكسور.`, 'danger', 7000); }
        setTimeout(() => { dom.crawlerStatus.classList.add('d-none'); }, 5000);
    }

    // --- UPDATED ---: Enhanced analysis logic is now integrated.
    function analyzeHtmlContent(content, urlOrFilename, options = {}) {
        const doc = new DOMParser().parseFromString(content, 'text/html');
        const isUrl = urlOrFilename.startsWith('http');
        const url = isUrl ? new URL(urlOrFilename) : null;
        const filename = isUrl ? (url.pathname.split('/').pop() || 'index.html') : urlOrFilename;
    
        // --- Basic SEO data ---
        let title = doc.querySelector('title')?.textContent.trim() || filename.replace(/\.(html?|htm)$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        let description = doc.querySelector('meta[name="description"]')?.getAttribute('content') || doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || doc.querySelector('article p, main p')?.textContent.trim().substring(0, 200) + '...' || `صفحة ${title}`;
        let keywords = doc.querySelector('meta[name="keywords"]')?.getAttribute('content')?.split(',').map(k => k.trim()).filter(Boolean) || [];
    
        const images = doc.querySelectorAll('img');
        const imagesWithoutAlt = [...images].filter(img => !img.getAttribute('alt')?.trim());
        const robotsMeta = doc.querySelector('meta[name="robots"]');
        const isNoIndex = robotsMeta ? /noindex/i.test(robotsMeta.getAttribute('content')) : false;
    
        // --- START: NEW ADVANCED ANALYSIS LOGIC ---
        const bodyText = doc.body?.textContent.trim() || '';
        const words = bodyText.split(/\s+/).filter(Boolean);
        const sentences = bodyText.match(/[^.!?]+[.!?]+/g) || [];
        const wordCount = words.length;
    
        // 1. Content & Readability Analysis
        const allLinks = [...doc.querySelectorAll('a[href]')];
        const pageHostname = url ? url.hostname : (isUrl ? new URL(urlOrFilename).hostname : window.location.hostname);

        const internalLinks = allLinks.filter(a => {
            const href = a.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
            try {
                return new URL(href, urlOrFilename).hostname === pageHostname;
            } catch { return !/^(https?:)?\/\//.test(href); } // Fallback for relative paths
        }).length;
        
        const externalLinks = allLinks.filter(a => {
            const href = a.getAttribute('href');
            if (!href) return false;
            try {
                const linkUrl = new URL(href, urlOrFilename);
                return linkUrl.hostname && linkUrl.hostname !== pageHostname;
            } catch { return /^(https?:)?\/\//.test(href); } // Fallback for absolute paths
        }).length;

        // Flesch-Kincaid Readability Score (Approximation)
        const syllableApproximation = words.reduce((acc, word) => acc + (word.match(/[aeiouy]{1,2}/gi) || []).length, 0);
        const readabilityScore = sentences.length > 0 && wordCount > 0 
            ? Math.max(0, 206.835 - 1.015 * (wordCount / sentences.length) - 84.6 * (syllableApproximation / wordCount)).toFixed(1)
            : null;

        // 2. Performance Metrics
        const pageSizeKB = (new TextEncoder().encode(content).length / 1024).toFixed(1);
        const resourceCounts = {
            js: doc.querySelectorAll('script[src]').length,
            css: doc.querySelectorAll('link[rel="stylesheet"]').length,
            images: images.length
        };
        
        // 3. Accessibility (a11y) Quick Scan
        const a11y = {
            formLabels: {
                total: doc.querySelectorAll('input, textarea, select').length,
                missing: [...doc.querySelectorAll('input:not([type=hidden]), textarea, select')].filter(el => !el.id || !doc.querySelector(`label[for="${el.id}"]`)).length
            },
            semanticHeaders: !!doc.querySelector('header'),
            semanticNav: !!doc.querySelector('nav'),
            semanticMain: !!doc.querySelector('main')
        };
        // --- END: NEW ADVANCED ANALYSIS LOGIC ---

        const seoData = {
            h1: doc.querySelector('h1')?.textContent.trim() || null,
            lang: doc.documentElement.getAttribute('lang') || null,
            canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
            imageAltInfo: { total: images.length, missing: imagesWithoutAlt.length },
            brokenLinksOnPage: [],
            loadTime: options.loadTime || null,
            isNoIndex: isNoIndex,
            ogTitle: doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || null,
            ogImage: doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || null,
            hasStructuredData: !!doc.querySelector('script[type="application/ld+json"]'),
            wordCount: wordCount,
            
            // --- NEW DATA OBJECTS ---
            contentAnalysis: {
                readabilityScore,
                internalLinks,
                externalLinks
            },
            performance: {
                pageSizeKB,
                resourceCounts
            },
            accessibility: a11y
        };
    
        return { filename, title, description, keywords, url: isUrl ? url.pathname : '/' + filename, source: isUrl ? 'seo_crawler' : 'html_analysis', content, seo: seoData };
    }

    function handleGenerateClick() {
        const newItems = generateSearchIndex();

        if (newItems.length === 0 && appState.searchIndex.length === 0) {
            return showNotification('يرجى إدخال بيانات أولاً', 'warning');
        }
        const addedCount = addItemsToIndex(newItems);

        if (addedCount > 0) {
            showNotification(`تم إضافة ${addedCount} عنصر جديد! الإجمالي: ${appState.searchIndex.length}`, 'success');
        } else {
            showNotification('لا توجد عناصر جديدة للإضافة. النتائج محدّثة.', 'info');
        }
        updateAllUI();
        debouncedSaveProject();
    }

    function addItemsToIndex(itemsToAdd) {
        const existingUrls = new Set(appState.searchIndex.map(item => item.url.endsWith('/') && item.url.length > 1 ? item.url.slice(0, -1) : item.url));
        let idCounter = appState.searchIndex.length > 0 ? Math.max(...appState.searchIndex.map(item => item.id)) + 1 : 1;
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
        const existingUrls = new Set(appState.searchIndex.map(item => item.url.endsWith('/') && item.url.length > 1 ? item.url.slice(0, -1) : item.url));
        const addItem = (item) => {
            const urlKey = item.url.endsWith('/') && item.url.length > 1 ? item.url.slice(0, -1) : item.url;
            if (!existingUrls.has(urlKey)) newItems.push(item);
        };

        appState.analyzedFiles.forEach(file => addItem({
            title: file.title, description: file.description, url: file.url,
            category: file.category || (file.source === 'seo_crawler' ? 'زاحف SEO' : 'تحليل تلقائي'),
            tags: file.keywords && file.keywords.length > 0 ? file.keywords : extractTagsFromUrl(file.url),
            source: file.source || 'html_analysis', seo: file.seo
        }));

        if (dom.manualInput.checked) { appState.manualPages.forEach(page => addItem({ ...page, source: 'manual' })); }

        dom.urlInput.value.trim().split('\n').filter(Boolean).forEach(urlStr => {
            const url = urlStr.trim().startsWith('/') ? urlStr.trim() : '/' + urlStr.trim();
            if (existingUrls.has(url)) return;

            const fileName = url.split('/').pop().replace(/\.html?$/, '');
            const pathParts = url.split('/').filter(Boolean);
            const category = pathParts.length > 1 ? pathParts[0] : 'عام';
            const titleMap = { 'index': 'الصفحة الرئيسية', 'about': 'من نحن', 'contact': 'اتصل بنا', 'services': 'خدماتنا', 'blog': 'المدونة' };
            let title = titleMap[fileName.toLowerCase()] || (fileName.charAt(0).toUpperCase() + fileName.slice(1).replace(/[-_]/g, ' '));
            let source = appState.sitemapUrls.includes(url) ? 'sitemap' : appState.robotsUrls.includes(url) ? 'robots' : 'url_generation';

            addItem({ title, description: `صفحة ${title}`, url, category: category.charAt(0).toUpperCase() + category.slice(1), tags: extractTagsFromUrl(url), source });
        });
        return newItems;
    }

    function calculateSeoScore(seo) {
        if (!seo) return { score: 0, maxScore: 9, color: '#6c757d', level: 'غير متوفر' };
        let score = 0;
        const maxScore = 9;
        if (seo.h1) score++;
        if (seo.canonical) score++;
        if (seo.imageAltInfo && seo.imageAltInfo.total > 0 && seo.imageAltInfo.missing === 0) score++;
        if (seo.brokenLinksOnPage && seo.brokenLinksOnPage.length === 0) score++;
        if (!seo.isNoIndex) score++;
        if (seo.lang) score++;
        if (seo.ogTitle && seo.ogImage) score++;
        if (seo.hasStructuredData) score++;
        if (seo.wordCount && seo.wordCount > 300) score++;

        const percentage = (score / maxScore) * 100;
        if (percentage >= 80) return { score, maxScore, color: '#198754', level: 'ممتاز' };
        if (percentage >= 50) return { score, maxScore, color: '#ffc107', level: 'جيد' };
        return { score, maxScore, color: '#dc3545', level: 'يحتاج لمراجعة' };
    }

    // --- UPDATED ---: Renders the new advanced analysis sections.
    function renderSeoSummary(seo, itemId) {
        if (!seo) return '';
        
        const h1 = seo.h1 ? `<span class="badge bg-success">موجود</span>` : `<span class="badge bg-danger">مفقود</span>`;
        const lang = seo.lang ? `<span class="badge bg-success">${seo.lang}</span>` : `<span class="badge bg-danger">مفقود</span>`;
        const canonical = seo.canonical ? `<span class="badge bg-success">موجود</span>` : `<span class="badge bg-danger">مفقود</span>`;
        const wordCount = `<span class="badge ${seo.wordCount > 300 ? 'bg-success' : 'bg-warning'}">${seo.wordCount}</span>`;

        let imgAltBadge;
        if (!seo.imageAltInfo || seo.imageAltInfo.total === 0) {
            imgAltBadge = `<span class="badge bg-secondary">لا يوجد</span>`;
        } else {
            imgAltBadge = `<span class="badge ${seo.imageAltInfo.missing === 0 ? 'bg-success' : 'bg-warning'}">${seo.imageAltInfo.total - seo.imageAltInfo.missing}/${seo.imageAltInfo.total}</span>`;
        }

        const brokenLinksCount = seo.brokenLinksOnPage?.length || 0;
        let brokenLinksHtml;
        if (brokenLinksCount > 0) {
            const collapseId = `brokenLinks-${itemId}`;
            brokenLinksHtml = `<span class="badge bg-danger cursor-pointer" data-bs-toggle="collapse" href="#${collapseId}" role="button">${brokenLinksCount}</span>
                <div class="collapse mt-2" id="${collapseId}"><ul class="list-group list-group-flush small">${seo.brokenLinksOnPage.map(link => `<li class="list-group-item list-group-item-danger py-1 px-2 text-break">${link}</li>`).join('')}</ul></div>`;
        } else {
            brokenLinksHtml = `<span class="badge bg-success">0</span>`;
        }
        
        const ogTags = (seo.ogTitle && seo.ogImage) ? `<span class="badge bg-success">موجود</span>` : `<span class="badge bg-warning" title="OG:Title أو OG:Image مفقود">ناقص</span>`;
        const structuredData = seo.hasStructuredData ? `<span class="badge bg-success">موجود</span>` : `<span class="badge bg-secondary">مفقود</span>`;

        const basicSeoHtml = `<div class="mt-2 pt-2 border-top border-opacity-10">
            <strong class="small text-body-secondary d-block mb-1">SEO أساسي:</strong>
            <div class="seo-summary-item"><strong>H1:</strong> ${h1}</div>
            <div class="seo-summary-item"><strong>Lang:</strong> ${lang}</div>
            <div class="seo-summary-item"><strong>Canonical:</strong> ${canonical}</div>
            <div class="seo-summary-item"><strong>Img Alt:</strong> ${imgAltBadge}</div>
            <div class="seo-summary-item"><strong>روابط مكسورة:</strong> ${brokenLinksHtml}</div>
            <div class="seo-summary-item"><strong>OG Tags:</strong> ${ogTags}</div>
            <div class="seo-summary-item"><strong>بيانات منظمة:</strong> ${structuredData}</div>
            <div class="seo-summary-item"><strong>عدد الكلمات:</strong> ${wordCount}</div>
        </div>`;
    
        let contentHtml = '';
        if (seo.contentAnalysis) {
            const { readabilityScore, internalLinks, externalLinks } = seo.contentAnalysis;
            let readabilityBadge;
            if (readabilityScore === null) {
                readabilityBadge = `<span class="badge bg-secondary">N/A</span>`;
            } else if (readabilityScore >= 60) {
                readabilityBadge = `<span class="badge bg-success" title="سهل القراءة">${readabilityScore}</span>`;
            } else if (readabilityScore >= 30) {
                readabilityBadge = `<span class="badge bg-warning" title="صعب القراءة قليلاً">${readabilityScore}</span>`;
            } else {
                readabilityBadge = `<span class="badge bg-danger" title="صعب القراءة جداً">${readabilityScore}</span>`;
            }
    
            contentHtml = `<div class="mt-2 pt-2 border-top border-opacity-10">
                    <strong class="small text-body-secondary d-block mb-1">تحليل المحتوى:</strong>
                    <div class="seo-summary-item"><strong>سهولة القراءة:</strong> ${readabilityBadge}</div>
                    <div class="seo-summary-item"><strong>روابط داخلية:</strong> <span class="badge bg-info">${internalLinks}</span></div>
                    <div class="seo-summary-item"><strong>روابط خارجية:</strong> <span class="badge bg-info">${externalLinks}</span></div>
                </div>`;
        }
    
        let performanceHtml = '';
        if (seo.performance) {
            const { pageSizeKB, resourceCounts } = seo.performance;
            const pageSizeBadgeColor = pageSizeKB > 500 ? 'bg-warning' : 'bg-success';
            performanceHtml = `<div class="mt-2 pt-2 border-top border-opacity-10">
                    <strong class="small text-body-secondary d-block mb-1">مقاييس الأداء:</strong>
                    <div class="seo-summary-item"><strong>حجم الصفحة:</strong> <span class="badge ${pageSizeBadgeColor}">${pageSizeKB} KB</span></div>
                    <div class="seo-summary-item" title="JS / CSS / Images"><strong>الموارد:</strong> <span class="badge bg-secondary">${resourceCounts.js}/${resourceCounts.css}/${resourceCounts.images}</span></div>
                </div>`;
        }
    
        let a11yHtml = '';
        if (seo.accessibility) {
            const { formLabels, semanticHeaders, semanticNav, semanticMain } = seo.accessibility;
            const formLabelsBadge = formLabels.total === 0 ? `<span class="badge bg-secondary">لا يوجد</span>` :
                                    formLabels.missing === 0 ? `<span class="badge bg-success">ممتاز</span>` :
                                    `<span class="badge bg-danger" title="${formLabels.missing} عنصر بدون label">${formLabels.missing} خطأ</span>`;
            
            const semanticsScore = [semanticHeaders, semanticNav, semanticMain].filter(Boolean).length;
            const semanticsBadge = semanticsScore === 3 ? `<span class="badge bg-success">ممتاز</span>` :
                                   semanticsScore > 0 ? `<span class="badge bg-warning">ناقص</span>` :
                                   `<span class="badge bg-danger">مفقود</span>`;
    
            a11yHtml = `<div class="mt-2 pt-2 border-top border-opacity-10">
                    <strong class="small text-body-secondary d-block mb-1">إمكانية الوصول (a11y):</strong>
                    <div class="seo-summary-item"><strong>Labels للنماذج:</strong> ${formLabelsBadge}</div>
                    <div class="seo-summary-item"><strong>بنية دلالية:</strong> ${semanticsBadge}</div>
                </div>`;
        }
    
        return basicSeoHtml + contentHtml + performanceHtml + a11yHtml;
    };

    function displayResults(resultsToShow = null, openAccordionId = null) {
        const results = resultsToShow || appState.searchIndex;

        dom.selectionControls.classList.toggle('d-none', results.length === 0);
        dom.exportButtons.classList.toggle('d-none', results.length === 0);
        dom.resultsPlaceholder.classList.toggle('d-none', results.length > 0);
        dom.resultsAccordion.innerHTML = '';

        if (results.length === 0) return;

        const grouped = results.reduce((acc, item) => {
            (acc[item.source || 'unknown'] = acc[item.source || 'unknown'] || []).push(item);
            return acc;
        }, {});

        Object.entries(grouped).forEach(([source, items], index) => {
            renderAccordionGroup(source, items, index, openAccordionId);
        });
        
        updateSelectionUI();
    }
    
    function renderAccordionGroup(source, items, index, openAccordionId = null) {
        const sourceLabels = {
            'seo_crawler': `<i class="bi bi-robot ms-2" aria-hidden="true"></i>زاحف SEO`,
            'html_analysis': `<i class="bi bi-file-earmark-code-fill ms-2" aria-hidden="true"></i>تحليل HTML`,
            'manual': `<i class="bi bi-pencil-fill ms-2" aria-hidden="true"></i>إدخال يدوي`,
            'url_generation': `<i class="bi bi-link-45deg ms-2" aria-hidden="true"></i>من الروابط`,
            'sitemap': `<i class="bi bi-map-fill ms-2" aria-hidden="true"></i>من Sitemap`,
            'robots': `<i class="bi bi-robot ms-2" aria-hidden="true"></i>من robots.txt`,
            'spa_analysis': `<i class="bi bi-lightning-charge-fill ms-2" aria-hidden="true"></i>تحليل SPA`
        };

        const collapseId = `collapse-source-${source.replace(/[^a-zA-Z0-9]/g, '-')}-${index}`;
        const shouldBeOpen = openAccordionId ? (collapseId === openAccordionId) : index === 0;

        const accordionItem = document.createElement('div');
        accordionItem.className = 'accordion-item bg-transparent';
        accordionItem.innerHTML = `
            <h2 class="accordion-header" id="heading-${collapseId}">
                <button class="accordion-button ${shouldBeOpen ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                    ${sourceLabels[source] || source} (${items.length})
                </button>
            </h2>
            <div id="${collapseId}" class="accordion-collapse collapse ${shouldBeOpen ? 'show' : ''}" data-bs-parent="#resultsAccordion">
                <div class="accordion-body" data-source="${source}" data-rendered-count="0">
                    <!-- Items will be lazy/virtually-loaded here -->
                </div>
            </div>`;
        
        dom.resultsAccordion.appendChild(accordionItem);
    }

    function renderItemChunk(container, items, offset) {
        const fragment = document.createDocumentFragment();
        const itemsToRender = items.slice(offset, offset + VIRTUAL_SCROLL_CHUNK_SIZE);
        
        itemsToRender.forEach(item => {
            const itemClone = resultItemTemplate.content.cloneNode(true);
            const resultItemEl = itemClone.querySelector('.result-item');
            
            const seoScore = calculateSeoScore(item.seo);
            const isSelected = appState.selectedItemIds.has(item.id);

            resultItemEl.dataset.id = item.id;
            if (isSelected) resultItemEl.classList.add('selected');
            
            itemClone.querySelector('.item-select-checkbox').checked = isSelected;
            
            const seoDot = itemClone.querySelector('.seo-score-dot');
            seoDot.style.backgroundColor = seoScore.color;
            seoDot.title = `تقييم SEO: ${seoScore.level} (${seoScore.score}/${seoScore.maxScore})`;

            itemClone.querySelector('.editable-content[data-field="title"]').textContent = item.title;
            itemClone.querySelector('.no-index-badge').classList.toggle('d-none', !item.seo?.isNoIndex);
            
            const previewBtn = itemClone.querySelector('.btn-preview');
            previewBtn.setAttribute('aria-label', `معاينة نتيجة: ${item.title}`);
            const editBtn = itemClone.querySelector('.btn-edit');
            editBtn.setAttribute('aria-label', `تحرير نتيجة: ${item.title}`);

            const deleteBtn = itemClone.querySelector('.btn-delete');
            deleteBtn.setAttribute('aria-label', `حذف نتيجة: ${item.title}`);


            itemClone.querySelector('[data-populate="url"]').textContent = item.url;
            itemClone.querySelector('[data-populate="loadTime"]').textContent = item.seo?.loadTime ? `${item.seo.loadTime}ms` : '';
            
            itemClone.querySelector('.editable-content[data-field="description"]').textContent = item.description;
            itemClone.querySelector('.editable-content[data-field="category"]').textContent = item.category || '';
            itemClone.querySelector('.editable-content[data-field="tags"]').textContent = (item.tags || []).join(', ');

            itemClone.querySelector('.seo-summary-container').innerHTML = renderSeoSummary(item.seo, item.id);
            
            fragment.appendChild(itemClone);
        });
        
        container.appendChild(fragment);

        const newRenderedCount = offset + itemsToRender.length;
        container.dataset.renderedCount = newRenderedCount;

        if (newRenderedCount < items.length) {
            const loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'btn btn-outline-secondary btn-sm w-100 mt-2 load-more-btn';
            loadMoreBtn.textContent = 'تحميل المزيد';
            container.appendChild(loadMoreBtn);
        }
    }

    function handleAccordionShow(event) {
        const accordionBody = event.target.querySelector('.accordion-body');
        if (accordionBody && parseInt(accordionBody.dataset.renderedCount, 10) === 0) {
            const source = accordionBody.dataset.source;
            const allVisibleItems = appState.filteredResults.length > 0 ? appState.filteredResults : appState.searchIndex;
            const itemsForThisGroup = allVisibleItems.filter(item => (item.source || 'unknown') === source);
            
            accordionBody.innerHTML = ''; // Clear spinner
            renderItemChunk(accordionBody, itemsForThisGroup, 0);
        }
    }

    function handleLoadMore(button) {
        const accordionBody = button.closest('.accordion-body');
        if (!accordionBody) return;

        const source = accordionBody.dataset.source;
        const currentOffset = parseInt(accordionBody.dataset.renderedCount, 10);
        const allVisibleItems = appState.filteredResults.length > 0 ? appState.filteredResults : appState.searchIndex;
        const itemsForThisGroup = allVisibleItems.filter(item => (item.source || 'unknown') === source);

        button.remove();
        renderItemChunk(accordionBody, itemsForThisGroup, currentOffset);
    }

    function updateAllUI(openAccordionId = null) {
        const results = appState.filteredResults.length > 0 ? appState.filteredResults : appState.searchIndex;
        displayResults(results, openAccordionId);
        
        if (openAccordionId) {
            const accordionBodyToRender = dom.resultsAccordion.querySelector(`#${openAccordionId} .accordion-body`);
            if (accordionBodyToRender && parseInt(accordionBodyToRender.dataset.renderedCount, 10) === 0) {
                const source = accordionBodyToRender.dataset.source;
                const itemsForThisGroup = results.filter(item => (item.source || 'unknown') === source);
                if (itemsForThisGroup.length > 0) {
                    accordionBodyToRender.innerHTML = '';
                    renderItemChunk(accordionBodyToRender, itemsForThisGroup, 0);
                }
            }
        }

        updateAnalyticsDashboard();
        updateLiveCounter();
        updateFilterOptions();
        dom.filterSection.classList.toggle('d-none', appState.searchIndex.length === 0);
        dom.selectionControls.classList.toggle('d-none', appState.searchIndex.length === 0);
        dom.schemaGeneratorSection.classList.toggle('d-none', appState.searchIndex.length === 0);
    }


    function updateLiveCounter() {
        if (appState.searchIndex.length > 0) {
            dom.liveCounter.classList.remove('d-none');
            dom.counterValue.textContent = appState.searchIndex.length;
        } else {
            dom.liveCounter.classList.add('d-none');
        }
    }

    const CHART_TEXT_COLOR = 'rgba(255, 255, 255, 0.85)';
    const CHART_GRID_COLOR = 'rgba(255, 255, 255, 0.15)';

    function renderSourceChart(labels, data) {
        const chartContext = dom.sourceDistributionChart.getContext('2d');
        const sourceLabels = {
            'seo_crawler': `زاحف SEO`,
            'html_analysis': `تحليل HTML`,
            'manual': `إدخال يدوي`,
            'url_generation': `من الروابط`,
            'sitemap': `من Sitemap`,
            'robots': `من robots.txt`,
            'spa_analysis': `تحليل SPA`,
            'unknown': 'غير معروف'
        };
        if (sourceChartInstance) {
            sourceChartInstance.data.labels = labels.map(l => sourceLabels[l] || l);
            sourceChartInstance.data.datasets[0].data = data;
            sourceChartInstance.update();
        } else {
            sourceChartInstance = new Chart(chartContext, {
                type: 'pie',
                data: {
                    labels: labels.map(l => sourceLabels[l] || l),
                    datasets: [{
                        label: 'عدد الصفحات',
                        data: data,
                        backgroundColor: ['#4bc0c0', '#ff6384', '#ffcd56', '#36a2eb', '#9966ff', '#c9cbcf', '#ff9f40'],
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: CHART_TEXT_COLOR,
                                boxWidth: 12,
                                padding: 15
                            }
                        }
                    }
                }
            });
        }
    }

    function renderKeywordsChart(labels, data) {
        const chartContext = dom.topKeywordsChart.getContext('2d');
        if (keywordsChartInstance) {
            keywordsChartInstance.data.labels = labels;
            keywordsChartInstance.data.datasets[0].data = data;
            keywordsChartInstance.update();
        } else {
            keywordsChartInstance = new Chart(chartContext, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'عدد التكرارات',
                        data: data,
                        backgroundColor: 'rgba(75, 192, 192, 0.6)',
                        borderColor: 'rgba(75, 192, 192, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: {
                                color: CHART_TEXT_COLOR,
                                stepSize: 1
                            },
                            grid: {
                                color: CHART_GRID_COLOR
                            }
                        },
                        y: {
                            ticks: {
                                color: CHART_TEXT_COLOR
                            },
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
        }
    }

    function renderSeoScoreChart(percentage) {
        const chartContext = dom.averageSeoScoreChart.getContext('2d');
        dom.seoScoreText.textContent = `${Math.round(percentage)}%`;
        const scoreColor = percentage >= 80 ? '#4bc0c0' : percentage >= 50 ? '#ffcd56' : '#ff6384';
        if (seoScoreChartInstance) {
            seoScoreChartInstance.data.datasets[0].data = [percentage, 100 - percentage];
            seoScoreChartInstance.data.datasets[0].backgroundColor[0] = scoreColor;
            seoScoreChartInstance.update();
        } else {
            seoScoreChartInstance = new Chart(chartContext, {
                type: 'doughnut',
                data: {
                    datasets: [{
                        data: [percentage, 100 - percentage],
                        backgroundColor: [scoreColor, 'rgba(255, 255, 255, 0.2)'],
                        borderColor: 'transparent',
                        circumference: 180,
                        rotation: 270,
                        cutout: '75%'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            enabled: false
                        }
                    }
                }
            });
        }
    }

    function updateAnalyticsDashboard() {
        if (appState.searchIndex.length === 0) {
            dom.analyticsDashboard.classList.add('d-none');
            return;
        }
        dom.analyticsDashboard.classList.remove('d-none');
        // 1. Source Distribution Data
        const sourceCounts = appState.searchIndex.reduce((acc, item) => {
            const source = item.source || 'unknown';
            acc[source] = (acc[source] || 0) + 1;
            return acc;
        }, {});
        const sourceLabels = Object.keys(sourceCounts);
        const sourceData = Object.values(sourceCounts);
        renderSourceChart(sourceLabels, sourceData);
        // 2. Top Keywords Data
        const allKeywords = appState.searchIndex.flatMap(item => item.tags || []);
        const keywordCount = allKeywords.reduce((acc, keyword) => {
            if (keyword) { 
                acc[keyword] = (acc[keyword] || 0) + 1;
            }
            return acc;
        }, {});
        const sortedKeywords = Object.entries(keywordCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
        const keywordLabels = sortedKeywords.map(entry => entry[0]);
        const keywordData = sortedKeywords.map(entry => entry[1]);
        renderKeywordsChart(keywordLabels, keywordData);
        // 3. Average SEO Score Data
        let totalScore = 0;
        let maxPossibleScore = 0;
        appState.searchIndex.forEach(item => {
            const {
                score,
                maxScore
            } = calculateSeoScore(item.seo);
            totalScore += score;
            maxPossibleScore += maxScore;
        });
        const averageSeoPercentage = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;
        renderSeoScoreChart(averageSeoPercentage);
    }

    function setupFilters() { dom.categoryFilter.addEventListener('change', applyFilters); dom.keywordFilter.addEventListener('input', applyFilters); }

    function updateFilterOptions() {
        const categoryFilter = dom.categoryFilter;
        const currentCategory = categoryFilter.value;
        const categories = [...new Set(appState.searchIndex.map(item => item.category).filter(Boolean))].sort();
        categoryFilter.innerHTML = '<option value="">جميع الفئات</option>';
        categories.forEach(category => {
            const option = document.createElement('option'); option.value = category; option.textContent = category;
            if (category === currentCategory) {
                option.selected = true;
            }
            categoryFilter.appendChild(option);
        });
    }

    function applyFilters() {
        const openAccordion = dom.resultsAccordion.querySelector('.accordion-collapse.show');
        const openAccordionId = openAccordion ? openAccordion.id : null;

        const categoryFilterValue = dom.categoryFilter.value;
        const keywordFilterValue = dom.keywordFilter.value.toLowerCase();
        appState.filteredResults = appState.searchIndex.filter(item => {
            const matchesCategory = !categoryFilterValue || item.category === categoryFilterValue;
            const matchesKeyword = !keywordFilterValue || item.title.toLowerCase().includes(keywordFilterValue) || item.description.toLowerCase().includes(keywordFilterValue) || (item.tags && item.tags.some(tag => tag.toLowerCase().includes(keywordFilterValue)));
            return matchesCategory && matchesKeyword;
        });
        
        updateAllUI(openAccordionId);
    }
    
    function updateSelectionUI() {
        document.querySelectorAll('.result-item').forEach(itemDiv => {
            const itemId = parseInt(itemDiv.dataset.id, 10);
            const isSelected = appState.selectedItemIds.has(itemId);
            itemDiv.classList.toggle('selected', isSelected);
            itemDiv.querySelector('.item-select-checkbox').checked = isSelected;
        });
        updateSelectionCounter();
    }

    function updateSelectionCounter() {
        dom.selectionCounter.textContent = appState.selectedItemIds.size;
    }

    function toggleItemSelection(checkbox, itemId) {
        if (checkbox.checked) {
            appState.selectedItemIds.add(itemId);
        } else {
            appState.selectedItemIds.delete(itemId);
        }
        updateSelectionUI();
    }
    
    function selectAllItems() {
        const itemsToSelect = appState.filteredResults.length > 0 ? appState.filteredResults : appState.searchIndex;
        itemsToSelect.forEach(item => appState.selectedItemIds.add(item.id));
        updateSelectionUI();
    }

    function deselectAllItems() {
        const itemsToDeselect = appState.filteredResults.length > 0 ? appState.filteredResults : appState.searchIndex;
        const idsToDeselect = new Set(itemsToDeselect.map(i => i.id));
        appState.selectedItemIds = new Set([...appState.selectedItemIds].filter(id => !idsToDeselect.has(id)));
        updateSelectionUI();
    }

    function getSelectedItems() {
        if (appState.selectedItemIds.size === 0) {
            return appState.filteredResults.length > 0 ? appState.filteredResults : appState.searchIndex;
        }
        return appState.searchIndex.filter(item => appState.selectedItemIds.has(item.id));
    }

    const getStrippedIndex = (items) => items.map(({ id, title, description, url, category, tags, seo }) => ({ id, title, description, url, category, tags, seo }));

    function downloadJson() {
        const itemsToDownload = getSelectedItems();
        if (itemsToDownload.length === 0) return showNotification('لا توجد عناصر للتصدير', 'warning');
        const data = getStrippedIndex(itemsToDownload);
        downloadFile(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'search-index.json');
        showNotification(`تم تحميل ${itemsToDownload.length} عنصر كـ JSON <i class="bi bi-filetype-json ms-2" aria-hidden="true"></i>`, 'success');
    }

    function downloadCSV() {
        const itemsToDownload = getSelectedItems();
        if (itemsToDownload.length === 0) return showNotification('لا توجد عناصر للتصدير', 'warning');
        const csv = ['ID,العنوان,الرابط,الوصف,الفئة,الكلمات المفتاحية', ...itemsToDownload.map(i => [`"${i.id}"`, `"${i.title.replace(/"/g, '""')}"`, `"${i.url}"`, `"${i.description.replace(/"/g, '""')}"`, `"${i.category || ''}"`, `"${(i.tags || []).join(', ')}"`].join(','))].join('\n');
        downloadFile(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }), 'search-index.csv');
        showNotification(`تم تحميل ${itemsToDownload.length} عنصر كـ CSV <i class="bi bi-filetype-csv ms-2" aria-hidden="true"></i>`, 'success');
    }

    async function downloadZip() {
        const itemsToDownload = getSelectedItems();
        if (itemsToDownload.length === 0) return showNotification('لا توجد عناصر للتصدير', 'warning');

        dom.zipProgress.classList.remove('d-none');
        try {
            const zip = new JSZip();
            zip.file('search-index.json', JSON.stringify(getStrippedIndex(itemsToDownload), null, 2));

            const selectedUrls = new Set(itemsToDownload.map(item => item.url));
            const htmlFiles = appState.analyzedFiles.filter(f => f.content && selectedUrls.has(f.url));

            if (htmlFiles.length > 0) { const htmlFolder = zip.folder('html-files'); htmlFiles.forEach(f => htmlFolder.file(f.filename, f.content)); }

            const content = await zip.generateAsync({ type: 'blob' }, (metadata) => { dom.zipProgressBar.style.width = metadata.percent.toFixed(2) + '%'; });
            downloadFile(content, 'search-index-package.zip');
            showNotification(`تم تحميل ${itemsToDownload.length} عنصر في حزمة ZIP <i class="bi bi-file-zip-fill ms-2" aria-hidden="true"></i>`, 'success');
        } catch (error) { showNotification('خطأ في إنشاء ZIP: ' + error.message, 'danger'); } finally { setTimeout(() => dom.zipProgress.classList.add('d-none'), 2000); }
    }

    function copyToClipboard(type) {
        const itemsToCopy = getSelectedItems();
        if (itemsToCopy.length === 0) return showNotification('لا توجد عناصر للنسخ', 'warning');

        const dataMap = {
            all: () => JSON.stringify(getStrippedIndex(itemsToCopy), null, 2),
            titles: () => itemsToCopy.map(item => item.title).join('\n'),
            urls: () => itemsToCopy.map(item => item.url).join('\n'),
            descriptions: () => itemsToCopy.map(item => item.description).join('\n')
        };
        const content = dataMap[type]();
        navigator.clipboard.writeText(content).then(() => {
            showNotification(`تم نسخ بيانات ${itemsToCopy.length} عنصر إلى الحافظة! <i class="bi bi-clipboard-check-fill ms-2" aria-hidden="true"></i>`, 'success');
            dom.copyOptions.classList.add('d-none');
        }).catch(err => showNotification('فشل النسخ!', 'danger'));
    }

    const getProjectStorageKey = (projectName) => `searchIndexGenerator_${projectName}`;

    function getProjectList() {
        try {
            return JSON.parse(localStorage.getItem(PROJECTS_MASTER_KEY)) || [];
        } catch (e) {
            return [];
        }
    }

    function updateProjectListDropdown() {
        const projects = getProjectList();
        const selector = dom.projectSelector;
        const currentProject = dom.projectNameInput.value;
        selector.innerHTML = '<option value="">-- اختر مشروعًا --</option>';
        projects.forEach(p => {
            const option = document.createElement('option');
            option.value = p;
            option.textContent = p;
            if (p === currentProject) {
                option.selected = true;
            }
            selector.appendChild(option);
        });
    }

    function clearCurrentState() {
        const defaultState = {
            searchIndex: [], manualPages: [], analyzedFiles: [], sitemapUrls: [], robotsUrls: [], manifestData: {}, filteredResults: [],
            schemaConfig: {
                baseUrl: '', pageSchemaType: 'WebPage', baseSchema: DEFAULT_BASE_SCHEMA_STR
            }
        };
        Object.assign(appState, defaultState);
        appState.selectedItemIds = new Set();
        
        ['urlInput', 'customProxyUrl', 'projectNameInput', 'projectSelector', 'schemaBaseUrl'].forEach(id => getEl(id).value = '');
        dom.schemaPageType.value = 'WebPage';
        const editor = dom.schemaBaseEditor;
        editor.value = defaultState.schemaConfig.baseSchema;
        editor.classList.remove('is-invalid', 'is-valid');
        validateSchemaEditor();
        
        updateAllUI();
    }

    function loadProject(projectName) {
        if (!projectName) {
            clearCurrentState();
            return;
        }
        try {
            const storageKey = getProjectStorageKey(projectName);
            const savedData = localStorage.getItem(storageKey);
            if (savedData) {
                const data = JSON.parse(savedData);
                const defaultSchemaConfig = { baseUrl: '', pageSchemaType: 'WebPage', baseSchema: DEFAULT_BASE_SCHEMA_STR };
                
                Object.assign(appState, {
                    searchIndex: data.searchIndex || [],
                    manualPages: data.manualPages || [],
                    analyzedFiles: data.analyzedFiles || [],
                    sitemapUrls: data.sitemapUrls || [],
                    robotsUrls: data.robotsUrls || [],
                    manifestData: data.manifestData || {},
                    schemaConfig: { ...defaultSchemaConfig, ...(data.schemaConfig || {})},
                    selectedItemIds: new Set()
                });
                dom.urlInput.value = data.urlInput || '';
                dom.customProxyUrl.value = data.customProxyUrl || '';
                dom.projectNameInput.value = projectName;

                dom.schemaBaseUrl.value = appState.schemaConfig.baseUrl;
                dom.schemaPageType.value = appState.schemaConfig.pageSchemaType;
                dom.schemaBaseEditor.value = appState.schemaConfig.baseSchema;
                validateSchemaEditor();

                localStorage.setItem(LAST_PROJECT_KEY, projectName);
                updateAllUI();
                updateProjectListDropdown();
                showNotification(`تم تحميل مشروع "${projectName}"! <i class="bi bi-folder2-open ms-2" aria-hidden="true"></i>`, 'info');
            }
        } catch (error) { showNotification('خطأ في تحميل المشروع: ' + error.message, 'warning'); }
    }
    
    function debouncedSaveProject() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveProject, 1000);
    }
    
    function saveProject() {
        const projectName = dom.projectNameInput.value.trim();
        if (!projectName) {
            return;
        }

        const filesToSave = appState.analyzedFiles.map(({ content, ...rest }) => rest);
        const data = {
            searchIndex: appState.searchIndex,
            manualPages: appState.manualPages,
            analyzedFiles: filesToSave,
            sitemapUrls: appState.sitemapUrls,
            robotsUrls: appState.robotsUrls,
            manifestData: appState.manifestData,
            schemaConfig: appState.schemaConfig,
            urlInput: dom.urlInput.value,
            customProxyUrl: dom.customProxyUrl.value,
            timestamp: new Date().toISOString()
        };
        try {
            const storageKey = getProjectStorageKey(projectName);
            localStorage.setItem(storageKey, JSON.stringify(data));

            let projects = getProjectList();
            if (!projects.includes(projectName)) {
                projects.push(projectName);
                localStorage.setItem(PROJECTS_MASTER_KEY, JSON.stringify(projects));
            }

            localStorage.setItem(LAST_PROJECT_KEY, projectName);
            updateProjectListDropdown();

        } catch (error) {
            showNotification('خطأ في حفظ البيانات: قد تكون مساحة التخزين ممتلئة. ' + error.message, 'danger');
        }
    }

    function handleManualSave() {
        const projectName = dom.projectNameInput.value.trim();
        if (!projectName) {
            return showNotification('يرجى إدخال اسم للمشروع قبل الحفظ.', 'warning');
        }

        if (validateSchemaEditor()) {
            appState.schemaConfig.baseSchema = dom.schemaBaseEditor.value;
        } else {
            showNotification('تم حفظ المشروع، لكن "السكيما الأساسية" تحتوي على أخطاء ولم يتم حفظها.', 'warning', 6000);
        }

        appState.schemaConfig.baseUrl = dom.schemaBaseUrl.value.trim();
        appState.schemaConfig.pageSchemaType = dom.schemaPageType.value;

        saveProject();
        showNotification(`تم حفظ المشروع "${projectName}" بنجاح! <i class="bi bi-save-fill ms-2" aria-hidden="true"></i>`, 'success');
    }

    function deleteSelectedProject() {
        const projectName = dom.projectSelector.value;
        if (!projectName) {
            return showNotification('يرجى اختيار مشروع من القائمة لحذفه.', 'warning');
        }
        if (confirm(`هل أنت متأكد من حذف المشروع "${projectName}"؟ لا يمكن التراجع عن هذا الإجراء.`)) {
            localStorage.removeItem(getProjectStorageKey(projectName));

            let projects = getProjectList();
            const newProjects = projects.filter(p => p !== projectName);
            localStorage.setItem(PROJECTS_MASTER_KEY, JSON.stringify(newProjects));

            if (dom.projectNameInput.value === projectName) {
                clearCurrentState();
            }

            updateProjectListDropdown();
            showNotification(`تم حذف المشروع "${projectName}" بنجاح! <i class="bi bi-trash3-fill ms-2" aria-hidden="true"></i>`, 'success');
        }
    }

    function loadLastProject() {
        const lastProject = localStorage.getItem(LAST_PROJECT_KEY);
        if (lastProject) {
            loadProject(lastProject);
        } else {
            validateSchemaEditor();
        }
    }

    async function processHtmlFiles(files) {
        const newAnalyzedFiles = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            if (!appState.analyzedFiles.find(f => f.filename === file.name)) {
                try {
                    const analysis = analyzeHtmlContent(await readFileContent(file), file.name);
                    appState.analyzedFiles.push(analysis);
                    newAnalyzedFiles.push(analysis);
                } catch (error) { console.error('Error processing file:', file.name, error); showNotification(`خطأ في معالجة الملف ${file.name}`, 'danger'); }
            }
            await new Promise(r => setTimeout(r, 50));
        }
        
        if (newAnalyzedFiles.length > 0) { showNotification(`تم تحليل ${newAnalyzedFiles.length} ملف HTML جديد!`, 'success'); }
        else { showNotification('جميع الملفات تم تحليلها مسبقاً', 'info'); }
        debouncedSaveProject();
    }

    function toggleCopyOptions() { dom.copyOptions.classList.toggle('d-none'); }

    async function analyzeSpaSite() {
        const url = dom.spaUrl.value.trim();
        if (!url) { return showNotification('يرجى إدخال رابط الموقع للتحليل', 'warning'); }
        showNotification(`🔬 جاري تحليل ${url}...`, 'info');
        try {
            const response = await fetch(getProxyUrl(url));
            if (!response.ok) { throw new Error(`فشل في جلب الموقع (Status: ${response.status})`); }
            const html = await response.text();

            const analysis = analyzeHtmlContent(html, url);
            const newItem = {
                title: analysis.title, description: analysis.description, url: url,
                category: 'تحليل SPA', tags: extractTagsFromUrl(url),
                source: 'spa_analysis', seo: analysis.seo
            };

            const addedCount = addItemsToIndex([newItem]);
            if (addedCount > 0) {
                showNotification(`✅ تم تحليل الموقع وإضافته للنتائج.`, 'success');
                updateAllUI();
                debouncedSaveProject();
            } else {
                showNotification('تم تحليل هذا الموقع مسبقاً وهو موجود بالفعل في النتائج.', 'info');
            }

        } catch (error) { console.error('SPA Analysis Error:', error); showNotification(`خطأ في تحليل الموقع: ${error.message}`, 'danger'); }
    }

    async function processRobotsFile(file) {
        try {
            const content = await readFileContent(file); const lines = content.split('\n').map(l => l.trim());
            const newRobotsUrls = lines.filter(l => l.toLowerCase().startsWith('disallow:') || l.toLowerCase().startsWith('allow:')).map(l => l.split(':')[1]?.trim()).filter(Boolean);
            if (newRobotsUrls.length > 0) {
                appState.robotsUrls.push(...newRobotsUrls);
                dom.urlInput.value = (dom.urlInput.value ? dom.urlInput.value + '\n' : '') + newRobotsUrls.join('\n');
                showNotification(`تم استخراج ${newRobotsUrls.length} مسار جديد من robots.txt!`, 'success'); debouncedSaveProject();
            } else { showNotification('لم يتم العثور على مسارات جديدة في ملف robots.txt', 'warning'); }
        } catch (error) { showNotification('خطأ في معالجة ملف robots.txt: ' + error.message, 'danger'); }
    }
    async function processManifestFile(file) {
        try {
            const content = await readFileContent(file);
            appState.manifestData = JSON.parse(content);
            const extractedUrls = [...(appState.manifestData.icons?.map(i => i.src) || []), ...(appState.manifestData.screenshots?.map(s => s.src) || []), appState.manifestData.start_url, ...(appState.manifestData.shortcuts?.map(s => s.url) || [])].filter(Boolean);
            if (extractedUrls.length > 0) {
                dom.urlInput.value = (dom.urlInput.value ? dom.urlInput.value + '\n' : '') + extractedUrls.join('\n');
                showNotification(`تم استخراج ${extractedUrls.length} مسار من manifest.json!`, 'success'); debouncedSaveProject();
            } else { showNotification('لم يتم العثور على مسارات صالحة في ملف manifest.json', 'warning'); }
        } catch (error) {
            if (error instanceof SyntaxError) {
                showNotification('خطأ في معالجة Manifest: تنسيق JSON غير صالح.', 'danger');
            } else {
                showNotification('خطأ في معالجة ملف manifest.json: ' + error.message, 'danger');
            }
        }
    }
    function setupTextareaDragDrop() {
        const textarea = dom.urlInput;
        textarea.addEventListener('dragover', (e) => { e.preventDefault(); textarea.classList.add('dragover'); });
        textarea.addEventListener('dragleave', () => textarea.classList.remove('dragover'));
        textarea.addEventListener('drop', (e) => { e.preventDefault(); textarea.classList.remove('dragover'); const files = Array.from(e.dataTransfer.files).filter(file => /\.txt|\.json$/.test(file.name)); if (files.length > 0) processDroppedTextFiles(files); });
    }
    async function processDroppedTextFiles(files) {
        for (const file of files) {
            try {
                const content = await readFileContent(file);
                let urls = file.name.endsWith('.json') ? (JSON.parse(content).urls || JSON.parse(content)) : content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
                if (Array.isArray(urls) && urls.length > 0) {
                    dom.urlInput.value = (dom.urlInput.value ? dom.urlInput.value + '\n' : '') + urls.join('\n');
                    showNotification(`تم إضافة ${urls.length} رابط من ${file.name}!`, 'success'); debouncedSaveProject();
                }
            } catch (error) { showNotification(`خطأ في معالجة ${file.name}: ${error.message}`, 'danger'); }
        }
    }

    function showNotification(message, type = 'info', duration = 5000) {
        const toastContainer = document.querySelector('.toast-container'); const toastId = 'toast-' + Date.now();
        const typeMapping = { 'info': 'bg-info', 'success': 'bg-success', 'warning': 'bg-warning', 'danger': 'bg-danger' };
        const toast = document.createElement('div'); toast.id = toastId; toast.className = `toast align-items-center ${typeMapping[type]} text-white border-0`;
        toast.setAttribute('role', 'alert'); toast.setAttribute('aria-live', 'assertive'); toast.setAttribute('aria-atomic', 'true');
        toast.innerHTML = `<div class="d-flex align-items-center">
                                 <div class="toast-body flex-grow-1">${message}</div>
                                 <button type="button" class="btn-close btn-close-white ms-2" data-bs-dismiss="toast" aria-label="Close"></button>
                               </div>`;
        toastContainer.appendChild(toast); const bsToast = new bootstrap.Toast(toast, { delay: duration }); bsToast.show(); toast.addEventListener('hidden.bs.toast', () => toast.remove());
    }
    async function processSitemapFile(file) {
        try {
            const content = await readFileContent(file); const xmlDoc = new DOMParser().parseFromString(content, 'text/xml');
            if (xmlDoc.querySelector('parsererror')) throw new Error('تنسيق XML غير صالح.');
            const newSitemapUrls = [...xmlDoc.querySelectorAll('url > loc, sitemap > loc')].map(el => { try { return new URL(el.textContent.trim()).pathname; } catch { return el.textContent.trim(); } }).filter(Boolean);
            if (newSitemapUrls.length > 0) {
                appState.sitemapUrls.push(...newSitemapUrls);
                dom.urlInput.value = (dom.urlInput.value ? dom.urlInput.value + '\n' : '') + newSitemapUrls.join('\n');
                showNotification(`تم استخراج ${newSitemapUrls.length} رابط جديد من Sitemap!`, 'success'); debouncedSaveProject();
            } else { showNotification('لم يتم العثور على روابط جديدة في ملف Sitemap', 'warning'); }
        } catch (error) { showNotification('خطأ في معالجة ملف Sitemap: ' + error.message, 'danger'); }
    }
    function readFileContent(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = e => resolve(e.target.result); reader.onerror = reject; reader.readAsText(file, 'UTF-8'); }); }

    function extractTagsFromUrl(url) {
        if (!url) return [];
        try {
            const dummyBase = url.startsWith('http') ? undefined : 'http://dummy.com';
            const pathParts = new URL(url, dummyBase).pathname.split('/').filter(p => p && p !== '');
            const tags = pathParts.flatMap(part => part.replace(/\.[^/.]+$/, '').split(/[-_\s]+/)).filter(p => p.length > 2).map(p => p.toLowerCase());
            const translations = { 'index': 'الرئيسية', 'home': 'الرئيسية', 'about': 'من نحن', 'contact': 'اتصل بنا', 'services': 'خدمات', 'products': 'منتجات', 'blog': 'مدونة', 'news': 'أخبار', 'portfolio': 'أعمال', 'team': 'فريق', 'pricing': 'أسعار', 'faq': 'أسئلة شائعة' };
            tags.forEach(tag => { if (translations[tag]) tags.push(translations[tag]); }); return [...new Set(tags)];
        } catch (e) {
            console.error("Could not parse URL for tags:", url, e);
            return [];
        }
    }
    function importUrlsFile() { const file = dom.urlsFileInput.files[0]; if (!file) { return showNotification('يرجى اختيار ملف أولاً', 'warning'); } processDroppedTextFiles([file]); }

    function addManualPage() {
        const [title, url, description, category, tagsValue] = ['pageTitle', 'pageUrl', 'pageDescription', 'pageCategory', 'pageTags'].map(id => getEl(id).value);
        if (!title || !url) return showNotification('يرجى إدخال العنوان والرابط على الأقل', 'warning');
        appState.manualPages.push({ title, url: url.startsWith('/') ? url : '/' + url, description, category: category || 'عام', tags: tagsValue.split(',').map(t => t.trim()).filter(Boolean) });
        ['pageTitle', 'pageUrl', 'pageDescription', 'pageCategory', 'pageTags'].forEach(id => getEl(id).value = ''); showNotification(`تم إضافة: ${title} يدويًا. اضغط "توليد" لإظهارها.`, 'success'); debouncedSaveProject();
    }

    function toggleEdit(itemId) {
        const pageItem = document.querySelector(`.result-item[data-id="${itemId}"]`);
        if (!pageItem) return;

        const editBtn = pageItem.querySelector('.btn-edit');
        const isEditing = pageItem.classList.contains('is-editing');
        const item = appState.searchIndex.find(i => i.id === itemId);
        if(!item) return;

        if (isEditing) {
            const fields = ['title', 'description', 'category', 'tags'];
            const updatedData = {};
            
            fields.forEach(field => {
                const input = pageItem.querySelector(`[data-edit-field="${field}"]`);
                updatedData[field] = input.value.trim();
            });

            if (!updatedData.title) {
                showNotification('حقل العنوان لا يمكن أن يكون فارغاً!', 'danger');
                return; 
            }

            fields.forEach(field => {
                const input = pageItem.querySelector(`[data-edit-field="${field}"]`);
                const value = updatedData[field];
                item[field] = field === 'tags' ? value.split(',').map(t => t.trim()).filter(Boolean) : value;

                const staticEl = document.createElement(input.dataset.originalTag);
                staticEl.className = input.dataset.originalClasses;
                staticEl.dataset.field = field;
                staticEl.textContent = value;
                input.replaceWith(staticEl);
            });

            pageItem.classList.remove('is-editing');
            editBtn.innerHTML = 'تحرير';
            editBtn.classList.remove('btn-success');
            editBtn.classList.add('btn-outline-secondary');
            
            showNotification('تم حفظ التعديلات!', 'success');
            updateAnalyticsDashboard();
            debouncedSaveProject();

        } else {
            pageItem.classList.add('is-editing');
            
            pageItem.querySelectorAll('.editable-content').forEach((el, index) => {
                const field = el.dataset.field;
                const value = item[field];
                
                let input;
                if (field === 'description') {
                    input = document.createElement('textarea');
                    input.rows = 3;
                } else {
                    input = document.createElement('input');
                    input.type = 'text';
                }
                
                input.className = 'form-control form-control-sm edit-input';
                input.dataset.editField = field;
                input.dataset.originalTag = el.tagName.toLowerCase();
                input.dataset.originalClasses = el.className;
                input.value = Array.isArray(value) ? value.join(', ') : value;
                
                el.replaceWith(input);
                if (index === 0) input.focus();
            });

            editBtn.innerHTML = 'حفظ';
            editBtn.classList.remove('btn-outline-secondary');
            editBtn.classList.add('btn-success');
            showSerpPreview(itemId);
        }
    }

    function deleteItem(itemId) {
        const itemToDelete = appState.searchIndex.find(i => i.id === itemId);
        if (!itemToDelete) return;
    
        if (confirm(`هل أنت متأكد من حذف العنصر:\n"${itemToDelete.title}"`)) {
            appState.searchIndex = appState.searchIndex.filter(i => i.id !== itemId);
    
            if (appState.filteredResults.length > 0) {
                appState.filteredResults = appState.filteredResults.filter(i => i.id !== itemId);
            }
    
            appState.selectedItemIds.delete(itemId);
    
            updateAllUI();
    
            showNotification(`تم حذف العنصر بنجاح!`, 'success');
            debouncedSaveProject();
        }
    }

    function showSerpPreview(itemId) {
        const item = appState.searchIndex.find(i => i.id === itemId);
        if (!item) return;
        
        getEl('previewUrl').textContent = item.url;
        getEl('previewTitle').textContent = item.title;
        getEl('previewDescription').textContent = item.description;
        getEl('titleCharCount').textContent = item.title.length;
        getEl('descCharCount').textContent = item.description.length;
    }

    const downloadFile = (blob, filename) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href); };

    function validateSchemaEditor() {
        const editor = dom.schemaBaseEditor;
        try {
            JSON.parse(editor.value);
            editor.classList.remove('is-invalid');
            editor.classList.add('is-valid');
            return true;
        } catch (e) {
            editor.classList.remove('is-valid');
            editor.classList.add('is-invalid');
            return false;
        }
    }
    
    function validateAndCommitSchemaConfig() {
        appState.schemaConfig.baseUrl = dom.schemaBaseUrl.value.trim();
        appState.schemaConfig.pageSchemaType = dom.schemaPageType.value;
        
        if (validateSchemaEditor()) {
            appState.schemaConfig.baseSchema = dom.schemaBaseEditor.value;
            return true;
        } else {
            showNotification('يرجى تصحيح الأخطاء في "السكيما الأساسية" قبل المتابعة.', 'danger');
            dom.schemaBaseEditor.focus();
            return false;
        }
    }

    function sanitizeForFilename(url) {
        return url
            .replace(/^https?:\/\/[^/]+/, '')
            .replace(/^\//, '')
            .replace(/\/$/, '')
            .replace(/\//g, '_')
            .replace(/[?&#=:%]/g, '-')
            .replace(/\.html?$/, '') || 'index';
    }

    async function generateAndDownloadSchema() {
        if (!validateAndCommitSchemaConfig()) return;

        const baseUrl = appState.schemaConfig.baseUrl;
        if (!baseUrl) {
            return showNotification('يرجى إدخال رابط الموقع الأساسي في قسم السكيما.', 'warning');
        }

        const itemsToProcess = getSelectedItems();
        if (itemsToProcess.length === 0) {
           showNotification('<strong>خطوة ناقصة:</strong> يجب أولاً توليد قائمة بالصفحات.', 'warning', 7000);
            dom.results.classList.add('border', 'border-warning', 'border-3', 'shadow');
            setTimeout(() => dom.results.classList.remove('border', 'border-warning', 'border-3', 'shadow'), 2500);
            return;
        }

        const zip = new JSZip();
        let baseSchemaObject;

        try {
            baseSchemaObject = JSON.parse(appState.schemaConfig.baseSchema);
            const websiteId = new URL('#website', baseUrl).href;
            baseSchemaObject.url = baseUrl;
            baseSchemaObject['@id'] = websiteId;
            zip.file('_schema_base.jsonld', JSON.stringify(baseSchemaObject, null, 2));

        } catch (e) {
            return showNotification('حدث خطأ غير متوقع أثناء معالجة السكيما الأساسية.', 'danger');
        }

        const pageSchemaType = appState.schemaConfig.pageSchemaType;
        const publisherName = baseSchemaObject.name || "Your Organization Name";
        const publisherLogoUrl = baseSchemaObject.logo || new URL("/logo.png", baseUrl).href;

        for (const item of itemsToProcess) {
            const pageUrl = new URL(item.url, baseUrl).href;
            const pageSchema = {
                "@context": "https://schema.org",
                "@type": pageSchemaType,
                "@id": pageUrl,
                "name": item.title,
                "headline": item.title,
                "description": item.description,
                "url": pageUrl,
                "isPartOf": { "@id": baseSchemaObject['@id'] },
                "primaryImageOfPage": {
                    "@type": "ImageObject",
                    "url": (item.seo && item.seo.ogImage) ? new URL(item.seo.ogImage, baseUrl).href : new URL('/og-image.png', baseUrl).href
                },
                "datePublished": new Date().toISOString().split('T')[0],
                "dateModified": new Date().toISOString().split('T')[0]
            };
            
            if (['Article', 'Product', 'Service'].includes(pageSchemaType)) {
                pageSchema.author = { "@type": "Organization", "name": publisherName };
                pageSchema.publisher = {
                    "@type": "Organization", "name": publisherName,
                    "logo": { "@type": "ImageObject", "url": publisherLogoUrl }
                };
            }
             if (pageSchemaType === 'WebPage') {
                delete pageSchema.author;
                delete pageSchema.publisher;
            }

            const filename = `${sanitizeForFilename(item.url)}.jsonld`;
            zip.file(filename, JSON.stringify(pageSchema, null, 2));
        }

        try {
            const content = await zip.generateAsync({ type: 'blob' });
            downloadFile(content, 'schema_package.zip');
            showNotification(`تم توليد حزمة سكيما لـ ${itemsToProcess.length} صفحة!`, 'success');
        } catch (error) {
            showNotification(`فشل في إنشاء حزمة ZIP: ${error.message}`, 'danger');
        }
    }

    function init() {
        const domIds = [
            'darkModeToggle', 'liveCounter', 'counterValue', 'seoCrawlerUrl', 'seoCrawlerDepth', 'customProxyUrl',
            'spaUrl', 'urlInput', 'manualInput', 'manualInputSection', 'projectSelector', 'projectNameInput',
            'analyticsDashboard', 'sourceDistributionChart', 'topKeywordsChart', 'averageSeoScoreChart', 'seoScoreText',
            'filterSection', 'categoryFilter', 'keywordFilter', 'selectionControls', 'selectionCounter',
            'results', 'resultsAccordion', 'resultsPlaceholder', 'exportButtons', 'zipProgress', 'zipProgressBar', 'copyOptions',
            'schemaGeneratorSection', 'schemaBaseUrl', 'schemaPageType', 'schemaBaseEditor', 'crawlerStatus',
            'crawlerCurrentUrl', 'crawlerProgressBar', 'crawlerProgressText', 'crawlerQueueCount', 'urlsFileInput'
        ];
        domIds.forEach(id => dom[id] = getEl(id));
        resultItemTemplate = getEl('resultItemTemplate');

        setDarkMode(isDarkMode);
        updateProjectListDropdown();
        loadLastProject();

        // --- Event Listeners ---
        dom.darkModeToggle.addEventListener('click', toggleDarkMode);
        getEl('startCrawlerBtn').addEventListener('click', startSeoCrawler);
        getEl('analyzeSpaBtn').addEventListener('click', analyzeSpaSite);
        getEl('importUrlsFileBtn').addEventListener('click', importUrlsFile);
        getEl('addManualPageBtn').addEventListener('click', addManualPage);
        getEl('generateIndexBtn').addEventListener('click', handleGenerateClick);
        getEl('selectAllBtn').addEventListener('click', selectAllItems);
        getEl('deselectAllBtn').addEventListener('click', deselectAllItems);
        getEl('downloadJsonBtn').addEventListener('click', downloadJson);
        getEl('downloadCsvBtn').addEventListener('click', downloadCSV);
        getEl('downloadZipBtn').addEventListener('click', downloadZip);
        getEl('toggleCopyBtn').addEventListener('click', toggleCopyOptions);
        getEl('saveProjectBtn').addEventListener('click', handleManualSave);
        dom.projectSelector.addEventListener('change', (e) => loadProject(e.target.value));
        getEl('deleteProjectBtn').addEventListener('click', deleteSelectedProject);
        getEl('clearFormBtn').addEventListener('click', () => {
            if (confirm('هل أنت متأكد من مسح جميع البيانات الحالية والبدء من جديد؟')) {
                clearCurrentState();
                showNotification('تم مسح كل شيء. أنت جاهز للبدء!', 'info');
            }
        });

        dom.manualInput.addEventListener('change', function () { dom.manualInputSection.classList.toggle('d-none', !this.checked); });
        getEl('hideCrawlerStatusBtn').addEventListener('click', () => dom.crawlerStatus.classList.add('d-none'));
        getEl('generateSchemaBtn').addEventListener('click', generateAndDownloadSchema);
        
        dom.schemaBaseUrl.addEventListener('change', () => {
            appState.schemaConfig.baseUrl = dom.schemaBaseUrl.value.trim();
            debouncedSaveProject();
        });
        dom.schemaPageType.addEventListener('change', () => {
            appState.schemaConfig.pageSchemaType = dom.schemaPageType.value;
            debouncedSaveProject();
        });

        dom.schemaBaseEditor.addEventListener('input', validateSchemaEditor);
        dom.schemaBaseEditor.addEventListener('blur', () => {
            if (validateSchemaEditor()) {
                appState.schemaConfig.baseSchema = dom.schemaBaseEditor.value;
                debouncedSaveProject();
            }
        });

        dom.results.addEventListener('click', function (e) {
            const button = e.target.closest('button');
            if (!button) return;

            if (button.classList.contains('load-more-btn')) {
                handleLoadMore(button);
                return;
            }
            
            const resultItem = button.closest('.result-item');
            if (!resultItem) return;

            const itemId = parseInt(resultItem.dataset.id, 10);
            
            if (button.classList.contains('btn-edit')) {
                toggleEdit(itemId);
            } else if (button.classList.contains('btn-preview')) {
                showSerpPreview(itemId);
            } else if (button.classList.contains('btn-delete')) {
                deleteItem(itemId);
            }
        });
        
        dom.results.addEventListener('change', function(e) {
            const target = e.target;
            if (target.classList.contains('item-select-checkbox')) {
                const resultItem = target.closest('.result-item');
                if (resultItem) {
                    const itemId = parseInt(resultItem.dataset.id, 10);
                    toggleItemSelection(target, itemId);
                }
            }
        });


        dom.resultsAccordion.addEventListener('show.bs.collapse', handleAccordionShow);
        
        if (dom.copyOptions) {
            dom.copyOptions.addEventListener('click', function (e) {
                const button = e.target.closest('button[data-copy-type]');
                if (button) copyToClipboard(button.dataset.copyType);
            });
        }

        const setupDragDrop = (dropZoneId, fileInputId, fileTypeRegex, processFunction) => {
            const dropZone = getEl(dropZoneId); const fileInput = getEl(fileInputId); if (!dropZone || !fileInput) return;
            dropZone.addEventListener('click', () => fileInput.click());
            dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                const files = Array.from(e.dataTransfer.files).filter(file => fileTypeRegex.test(file.type) || fileTypeRegex.test(file.name));
                if (files.length > 0) processFunction(fileInput.multiple ? files : files[0]);
            });
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) processFunction(fileInput.multiple ? Array.from(e.target.files) : e.target.files[0]);
            });
        };

        setupDragDrop('robotsDropZone', 'robotsFileInput', /\.txt$/, processRobotsFile);
        setupDragDrop('manifestDropZone', 'manifestFileInput', /\.json$/, processManifestFile);
        setupDragDrop('sitemapDropZone', 'sitemapFileInput', /\.xml$/, processSitemapFile);
        setupDragDrop('fileDropZone', 'htmlFileInput', /\.html?$/, processHtmlFiles);
        setupTextareaDragDrop();
        setupFilters();
    }

    window.addEventListener('DOMContentLoaded', init);

})(); // End of IIFE
