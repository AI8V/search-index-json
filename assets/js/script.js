/* --- START OF FILE script.js --- */
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

    const PROJECTS_MASTER_KEY = 'searchIndexGenerator_projects';
    const LAST_PROJECT_KEY = 'searchIndexGenerator_lastProject';

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    let isDarkMode = localStorage.getItem('darkMode') === 'true' || (localStorage.getItem('darkMode') === null && prefersDark);
    
    // --- IMPROVEMENT: DOM Element Caching for performance ---
    const dom = {};
    let resultItemTemplate; // To be populated on DOMContentLoaded

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

    function analyzeHtmlContent(content, urlOrFilename, options = {}) {
        const doc = new DOMParser().parseFromString(content, 'text/html');
        const isUrl = urlOrFilename.startsWith('http');
        const url = isUrl ? new URL(urlOrFilename) : null;
        const filename = isUrl ? url.pathname.split('/').pop() || 'index.html' : urlOrFilename;

        let title = doc.querySelector('title')?.textContent.trim() || filename.replace(/\.(html?|htm)$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        let description = doc.querySelector('meta[name="description"]')?.getAttribute('content') || doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || doc.querySelector('article p, main p')?.textContent.trim().substring(0, 200) + '...' || `صفحة ${title}`;
        let keywords = doc.querySelector('meta[name="keywords"]')?.getAttribute('content')?.split(',').map(k => k.trim()).filter(Boolean) || [];

        const images = doc.querySelectorAll('img');
        const imagesWithoutAlt = [...images].filter(img => !img.getAttribute('alt')?.trim());
        const robotsMeta = doc.querySelector('meta[name="robots"]');
        const isNoIndex = robotsMeta ? /noindex/i.test(robotsMeta.getAttribute('content')) : false;

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
            wordCount: doc.body?.textContent.trim().split(/\s+/).filter(Boolean).length || 0
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

    function renderSeoSummary(seo, itemId) {
        if (!seo) return '';
        const h1 = seo.h1 ? `<span class="badge bg-success">موجود</span>` : `<span class="badge bg-danger">مفقود</span>`;
        const canonical = seo.canonical ? `<span class="badge bg-success">موجود</span>` : `<span class="badge bg-danger">مفقود</span>`;
        const lang = seo.lang ? `<span class="badge bg-success">${seo.lang}</span>` : `<span class="badge bg-danger">مفقود</span>`;

        let imgAltBadge;
        if (!seo.imageAltInfo || seo.imageAltInfo.total === 0) {
            imgAltBadge = `<span class="badge bg-secondary">لا يوجد</span>`;
        } else if (seo.imageAltInfo.missing === 0) {
            imgAltBadge = `<span class="badge bg-success">${seo.imageAltInfo.total}/${seo.imageAltInfo.total}</span>`;
        } else {
            imgAltBadge = `<span class="badge bg-warning">${seo.imageAltInfo.total - seo.imageAltInfo.missing}/${seo.imageAltInfo.total}</span>`;
        }

        const brokenLinksCount = seo.brokenLinksOnPage?.length || 0;
        let brokenLinksHtml;
        if (brokenLinksCount > 0) {
            const collapseId = `brokenLinks-${itemId}`;
            brokenLinksHtml = `
                    <span class="badge bg-danger cursor-pointer" data-bs-toggle="collapse" href="#${collapseId}" role="button">${brokenLinksCount}</span>
                    <div class="collapse mt-2" id="${collapseId}">
                        <ul class="list-group list-group-flush small">
                            ${seo.brokenLinksOnPage.map(link => `<li class="list-group-item list-group-item-danger py-1 px-2 text-break">${link}</li>`).join('')}
                        </ul>
                    </div>`;
        } else {
            brokenLinksHtml = `<span class="badge bg-success">0</span>`;
        }
        
        const ogTags = (seo.ogTitle && seo.ogImage) ? `<span class="badge bg-success">موجود</span>` : `<span class="badge bg-warning" title="OG:Title أو OG:Image مفقود">ناقص</span>`;
        const structuredData = seo.hasStructuredData ? `<span class="badge bg-success">موجود</span>` : `<span class="badge bg-secondary">مفقود</span>`;
        const wordCountBadgeColor = seo.wordCount > 300 ? 'bg-success' : 'bg-warning';
        const wordCount = `<span class="badge ${wordCountBadgeColor}">${seo.wordCount}</span>`;

        return `<div class="mt-2 pt-2 border-top border-opacity-10">
                <div class="seo-summary-item"><strong>H1:</strong> ${h1}</div>
                <div class="seo-summary-item"><strong>Lang:</strong> ${lang}</div>
                <div class="seo-summary-item"><strong>Canonical:</strong> ${canonical}</div>
                <div class="seo-summary-item"><strong>Img Alt:</strong> ${imgAltBadge}</div>
                <div class="seo-summary-item"><strong>روابط مكسورة:</strong> ${brokenLinksHtml}</div>
                <div class="seo-summary-item"><strong>OG Tags:</strong> ${ogTags}</div>
                <div class="seo-summary-item"><strong>بيانات منظمة:</strong> ${structuredData}</div>
                <div class="seo-summary-item"><strong>عدد الكلمات:</strong> ${wordCount}</div>
            </div>`;
    };

    // --- IMPROVEMENT: Major refactor of displayResults for performance (Lazy Loading) ---
    function displayResults(resultsToShow = null) {
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
            renderAccordionGroup(source, items, index);
        });
        
        updateSelectionCounter();
    }
    
    function renderAccordionGroup(source, items, index) {
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
        const isFirst = index === 0;

        const accordionItem = document.createElement('div');
        accordionItem.className = 'accordion-item bg-transparent';
        accordionItem.innerHTML = `
            <h2 class="accordion-header" id="heading-${collapseId}">
                <button class="accordion-button ${isFirst ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                    ${sourceLabels[source] || source} (${items.length})
                </button>
            </h2>
            <div id="${collapseId}" class="accordion-collapse collapse ${isFirst ? 'show' : ''}" data-bs-parent="#resultsAccordion">
                <div class="accordion-body" data-loaded="false" data-items='${JSON.stringify(items.map(i => i.id))}'>
                    <!-- Items will be lazy-loaded here -->
                    <div class="text-center p-3">
                        <div class="spinner-border spinner-border-sm" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                    </div>
                </div>
            </div>`;
        
        dom.resultsAccordion.appendChild(accordionItem);
    }

    function renderItemsInBody(accordionBody) {
        const itemIds = JSON.parse(accordionBody.dataset.items);
        const itemsToRender = itemIds.map(id => appState.searchIndex.find(item => item.id === id)).filter(Boolean);

        accordionBody.innerHTML = ''; // Clear spinner
        
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

            itemClone.querySelector('[data-populate="url"]').textContent = item.url;
            itemClone.querySelector('[data-populate="loadTime"]').textContent = item.seo?.loadTime ? `${item.seo.loadTime}ms` : '';
            
            itemClone.querySelector('.editable-content[data-field="description"]').textContent = item.description;
            itemClone.querySelector('.editable-content[data-field="category"]').textContent = item.category || '';
            itemClone.querySelector('.editable-content[data-field="tags"]').textContent = (item.tags || []).join(', ');

            itemClone.querySelector('.seo-summary-container').innerHTML = renderSeoSummary(item.seo, item.id);
            
            accordionBody.appendChild(itemClone);
        });
    }

    function updateAllUI() {
        displayResults(appState.filteredResults.length > 0 ? appState.filteredResults : appState.searchIndex);
        updateStatistics();
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

    function updateStatistics() {
        if (appState.searchIndex.length === 0) {
            dom.statsPanel.classList.add('d-none');
            return;
        }
        dom.statsPanel.classList.remove('d-none');
        const allKeywords = appState.searchIndex.flatMap(item => item.tags || []);
        const uniqueCategories = [...new Set(appState.searchIndex.map(item => item.category).filter(Boolean))];
        const keywordCount = allKeywords.reduce((acc, keyword) => {
            acc[keyword] = (acc[keyword] || 0) + 1;
            return acc;
        }, {});
        const topKeyword = Object.keys(keywordCount).reduce((a, b) => keywordCount[a] > keywordCount[b] ? a : b, '-');
        getEl('statPages').textContent = appState.searchIndex.length;
        getEl('statKeywords').textContent = allKeywords.length;
        getEl('statCategories').textContent = uniqueCategories.length;
        getEl('statTopKeyword').textContent = topKeyword === '-' ? '-' : `${topKeyword} (${keywordCount[topKeyword]})`;
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
        const categoryFilterValue = dom.categoryFilter.value;
        const keywordFilterValue = dom.keywordFilter.value.toLowerCase();
        appState.filteredResults = appState.searchIndex.filter(item => {
            const matchesCategory = !categoryFilterValue || item.category === categoryFilterValue;
            const matchesKeyword = !keywordFilterValue || item.title.toLowerCase().includes(keywordFilterValue) || item.description.toLowerCase().includes(keywordFilterValue) || (item.tags && item.tags.some(tag => tag.toLowerCase().includes(keywordFilterValue)));
            return matchesCategory && matchesKeyword;
        });
        displayResults(appState.filteredResults);
    }

    function updateSelectionCounter() {
        dom.selectionCounter.textContent = appState.selectedItemIds.size;
    }

    function toggleItemSelection(checkbox, itemId) {
        const itemDiv = document.querySelector(`.result-item[data-id="${itemId}"]`);
        if (checkbox.checked) {
            appState.selectedItemIds.add(itemId);
            itemDiv?.classList.add('selected');
        } else {
            appState.selectedItemIds.delete(itemId);
            itemDiv?.classList.remove('selected');
        }
        updateSelectionCounter();
    }

    function selectAllItems() {
        const currentlyVisibleItems = document.querySelectorAll('#results .result-item');
        currentlyVisibleItems.forEach(itemDiv => {
            const itemId = parseInt(itemDiv.dataset.id, 10);
            const checkbox = itemDiv.querySelector('input[type="checkbox"]');
            if (checkbox && !checkbox.checked) {
                checkbox.checked = true;
                appState.selectedItemIds.add(itemId);
                itemDiv.classList.add('selected');
            }
        });
        updateSelectionCounter();
    }

    function deselectAllItems() {
        document.querySelectorAll('#results .result-item').forEach(itemDiv => {
            const checkbox = itemDiv.querySelector('input[type="checkbox"]');
            if (checkbox && checkbox.checked) checkbox.checked = false;
            itemDiv.classList.remove('selected');
        });
        appState.selectedItemIds.clear();
        updateSelectionCounter();
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
    
    // --- IMPROVEMENT: Debounced save function to reduce localStorage writes ---
    let saveTimeout;
    function debouncedSaveProject() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveProject, 1000); // Save after 1 second of inactivity
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

        saveProject(); // Direct save, no debounce
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

    // --- IMPROVEMENT: Complete refactor of toggleEdit for Accessibility and UX ---
    function toggleEdit(itemId) {
        const pageItem = document.querySelector(`.result-item[data-id="${itemId}"]`);
        if (!pageItem) return;

        const editBtn = pageItem.querySelector('.btn-edit');
        const isEditing = pageItem.classList.contains('is-editing');
        const item = appState.searchIndex.find(i => i.id === itemId);
        if(!item) return;

        if (isEditing) { // --- Currently editing, switching to SAVE ---
            const fields = ['title', 'description', 'category', 'tags'];
            let isValid = true;
            fields.forEach(field => {
                const input = pageItem.querySelector(`[data-edit-field="${field}"]`);
                const value = input.value.trim();
                if (field === 'title' && !value) isValid = false;
                
                // Update state
                item[field] = field === 'tags' ? value.split(',').map(t => t.trim()).filter(Boolean) : value;

                // Revert to static element
                const staticEl = document.createElement(input.dataset.originalTag);
                staticEl.className = input.dataset.originalClasses;
                staticEl.dataset.field = field;
                staticEl.textContent = value;
                input.replaceWith(staticEl);
            });

            if(!isValid) {
                 showNotification('حقل العنوان لا يمكن أن يكون فارغاً!', 'danger');
                 // Re-enable editing mode immediately
                 toggleEdit(itemId); 
                 return;
            }

            pageItem.classList.remove('is-editing');
            editBtn.innerHTML = 'تحرير';
            editBtn.classList.remove('btn-success');
            editBtn.classList.add('btn-outline-secondary');
            
            showNotification('تم حفظ التعديلات!', 'success');
            updateStatistics();
            debouncedSaveProject();

        } else { // --- Not editing, switching to EDIT ---
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
                if (index === 0) input.focus(); // Focus on the first input (title)
            });

            editBtn.innerHTML = 'حفظ';
            editBtn.classList.remove('btn-outline-secondary');
            editBtn.classList.add('btn-success');
            showSerpPreview(itemId);
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

    // --- SCHEMA GENERATOR FUNCTIONS (Unchanged, but now benefits from app structure) ---
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
            showNotification('يرجى تصحيح الأخطاء في "السكيما الأساسية" قبل المتابعة. الحقل محاط باللون الأحمر.', 'danger');
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
            showNotification('<strong>خطوة ناقصة:</strong> يجب أولاً توليد قائمة بالصفحات في قسم "النتائج" لتتمكن من إنشاء السكيما لها.', 'warning', 7000);
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
                "isPartOf": {
                    "@id": baseSchemaObject['@id']
                },
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
        // --- IMPROVEMENT: Cache all frequently used DOM elements ---
        const domIds = [
            'darkModeToggle', 'liveCounter', 'counterValue', 'seoCrawlerUrl', 'seoCrawlerDepth', 'customProxyUrl',
            'spaUrl', 'urlInput', 'manualInput', 'manualInputSection', 'projectSelector', 'projectNameInput',
            'statsPanel', 'filterSection', 'categoryFilter', 'keywordFilter', 'selectionControls', 'selectionCounter',
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
            const target = e.target;
            const resultItem = target.closest('.result-item');
            if (!resultItem) return;

            const itemId = parseInt(resultItem.dataset.id, 10);
            if (target.classList.contains('btn-edit')) {
                toggleEdit(itemId);
            } else if (target.classList.contains('btn-preview')) {
                showSerpPreview(itemId);
            } else if (target.classList.contains('item-select-checkbox')) {
                toggleItemSelection(target, itemId);
            }
        });

        // --- IMPROVEMENT: Lazy loading listener ---
        dom.resultsAccordion.addEventListener('show.bs.collapse', event => {
            const accordionBody = event.target.querySelector('.accordion-body');
            if (accordionBody && accordionBody.dataset.loaded === 'false') {
                renderItemsInBody(accordionBody);
                accordionBody.dataset.loaded = 'true';
            }
        });
        
        if (dom.copyOptions) {
            dom.copyOptions.addEventListener('click', function (e) {
                const button = e.target.closest('button[data-copy-type]');
                if (button) copyToClipboard(button.dataset.copyType);
            });
        }

        const setupDragDrop = (dropZoneId, fileInputId, fileTypeRegex, processFunction) => {
            const dropZone = getEl(dropZoneId); const fileInput = getEl(fileInputId); if (!dropZone || !fileInput) return;
            dropZone.addEventListener('click', () => fileInput.click()); dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
            dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); const files = Array.from(e.dataTransfer.files).filter(file => fileTypeRegex.test(file.type) || fileTypeRegex.test(file.name)); if (files.length > 0) processFunction(fileInput.multiple ? files : files[0]); });
            fileInput.addEventListener('change', (e) => { if (e.target.files.length > 0) processFunction(fileInput.multiple ? Array.from(e.target.files) : e.target.files[0]); });
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