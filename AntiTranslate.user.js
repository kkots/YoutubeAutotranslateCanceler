// ==UserScript==
// @name         Youtube Auto-translate Canceler
// @namespace    https://github.com/pcouy/YoutubeAutotranslateCanceler/
// @version      0.4
// @description  Remove auto-translated youtube titles
// @author       Pierre Couy
// @match        https://www.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==


(function() {
    'use strict';
    // Original code:
    // https://github.com/Seneral/YoutubeAutotranslateCanceler/blob/master/AntiTranslate.user.js
    // This is a modified version of that code.
    /*
    Get a YouTube Data v3 API key from https://console.developers.google.com/apis/library/youtube.googleapis.com?q=YoutubeData
    */
    var NO_API_KEY = false;
    if(GM_getValue("api_key") === undefined || GM_getValue("api_key") === null || GM_getValue("api_key") === ""){
        GM_setValue("api_key", prompt("Enter your API key. Go to https://developers.google.com/youtube/v3/getting-started to know how to obtain an API key, then go to https://console.developers.google.com/apis/api/youtube.googleapis.com/ in order to enable Youtube Data API for your key."));
    }
    if(GM_getValue("api_key") === undefined || GM_getValue("api_key") === null || GM_getValue("api_key") === ""){
        NO_API_KEY = true; // Resets after page reload, still allows local title to be replaced
    }
    const API_KEY = GM_getValue("api_key");
    var API_KEY_VALID = false;


    var url_template = "https://www.googleapis.com/youtube/v3/videos?part=snippet&id={IDs}&key=" + API_KEY;

    var cachedTitles = {} // Dictionary(id, title): Cache of API fetches, survives only Youtube Autoplay

    var currentLocation; // String: Current page URL
    var needChangeDescription;
    var changedExpandedDescription = false; // Bool: Changed description
    var changedSnippetDescription = false; // Bool: Changed description
    var videoDescription; // Object: { snippet, expanded }. Snippet/expanded: String: video description obtained using API
    var videoDescriptionFailed = false;
    var alreadyChanged; // List(string): Links already changed
    var alreadyChangedDescriptions; // List(string): Links already changed
    var recheckTimer = -1; // Timer to recheck changes on the page AFTER initial load

    function findDescription()
    {
        var pageDescriptionExpandedIterator = document.evaluate('//div[@id="description" and @class="item style-scope ytd-watch-metadata"]//div[@id="expanded"]//span[@class="yt-core-attributed-string yt-core-attributed-string--white-space-pre-wrap" and @dir="auto"]', document, null, 	XPathResult.ORDERED_NODE_ITERATOR_TYPE);
        var pageDescriptionExpanded = pageDescriptionExpandedIterator.iterateNext();
        var pageDescriptionSnippetIterator = document.evaluate('//div[@id="description" and @class="item style-scope ytd-watch-metadata"]//div[@id="snippet"]//span[@class="yt-core-attributed-string yt-core-attributed-string--white-space-pre-wrap" and @dir="auto"]', document, null, 	XPathResult.ORDERED_NODE_ITERATOR_TYPE);
        var pageDescriptionSnippet = pageDescriptionSnippetIterator.iterateNext();
        return { expanded: pageDescriptionExpanded, snippet: pageDescriptionSnippet };
    }

    function containsJapanese(s)
    {
        if (typeof s != "string") return false;
        for (var c of s)  // iterate like this to handle surrogate pairs
        {
            var codePoint = c.codePointAt(0);
            // CJK Symbols and Punctuation U+3000-U+30ff
            // kanbun?? bopomofo?? inbetween
            // CJK Unified Ideographs U+4E00 - U+9FFF
            // Halfwidth and Fullwidth Forms U+FF00–FFEF
            if (codePoint >= 0x3000 && codePoint <= 0x9FFF
                || codePoint >= 0xFF00 && codePoint <= 0xFFEF)
            {
                return true;
            }
        }
        return false;
    }
    
    function getVideoID(a)
    {
        while(a.tagName != "A") a = a.parentNode;
        return a.href.match (/(?:v=)([a-zA-Z0-9-_]{11})/)[1];
    }

    function getH3(a)
    {
        while(a.tagName != "H3") a = a.parentNode;
        return a;
    }

    function resetChanged(){
        console.log(" --- Page Change detected! --- ");
        currentLocation = document.title;
        changedExpandedDescription = false;
        changedSnippetDescription = false;
        videoDescription = undefined;
        videoDescriptionFailed = false;
        alreadyChanged = [];
        alreadyChangedDescriptions = [];
    }

    function tryReplaceVideoDescription(description)
    {
        if (videoDescription === undefined
            || changedSnippetDescription && changedExpandedDescription) return;

        if (description === null)
        {
            description = findDescription();
        }

        if (description.snippet && !changedSnippetDescription)
        {
            changedSnippetDescription = true;
            description.snippet.innerHTML = videoDescription.snippet;
            console.log ("Reverting main video snippet description!");
        }

        if (description.expanded && !changedExpandedDescription)
        {
            changedExpandedDescription = true;
            description.expanded.innerHTML = videoDescription.expanded;
            console.log ("Reverting main video expanded description!");
        }
    }

    function changeTitles(){
        if(currentLocation !== document.title) resetChanged();

        // MAIN TITLE - no API key required
        if (window.location.href.includes ("/watch")){
            var titleMatch = document.title.match (/^(?:\([0-9]+\) )?(.*?)(?: - YouTube)$/); // ("(n) ") + "TITLE - YouTube"
            if (!titleMatch) {
                console.log ("ERROR: Video is deleted!");
                if (recheckTimer == -1) recheckTimer = setInterval(changeTitles, 1000);
                return;
            }
            var pageTitle = document.getElementsByClassName("title style-scope ytd-video-primary-info-renderer");
            if (pageTitle.length > 0 && pageTitle[0] !== undefined && titleMatch != null) {
                if (pageTitle[0].innerText != titleMatch[1]){
                    console.log ("Reverting main video title '" + pageTitle[0].innerText + "' to '" + titleMatch[1] + "'");
                    pageTitle[0].innerText = titleMatch[1];
                }
            }
        }

        if (NO_API_KEY) {
            return;
        }

        var videoIDElements = [];
        if (window.location.href == "https://www.youtube.com/feed/subscriptions")
        {
            var titleNodeList = document.querySelectorAll("#video-title");
            var descriptionNodeList = document.querySelectorAll("#description-text");
            for (var i = 0; i < titleNodeList.length; ++i)
            {
                var titleNode = titleNodeList[i];
                
                var titleNodeAlreadyChanged = alreadyChanged.indexOf(titleNode) != -1;
                
                var descriptionNode = null;
                if (i < descriptionNodeList.length)
                {
                    descriptionNode = descriptionNodeList[i];
                    
                    if (alreadyChangedDescriptions.indexOf(descriptionNode) != -1)
                    {
                        descriptionNode = null;
                    }
                }
                
                if (!titleNodeAlreadyChanged && containsJapanese(titleNode.title)
                    || descriptionNode != null && containsJapanese(descriptionNode.innerText))
                {
                    videoIDElements.push({ title: titleNode, description: descriptionNode, h3: null });
                }
                
            }
        } else {
            var videoIDElementsIterator = document.evaluate('//h3[@class="yt-lockup-metadata-view-model__heading-reset"]/a/span',
                document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE);
            var videoIDElement;
            while ((videoIDElement = videoIDElementsIterator.iterateNext()) && videoIDElement != null)
            {
                if (alreadyChanged.indexOf(videoIDElement) == -1 && containsJapanese(videoIDElement.innerText))
                {
                    videoIDElements.push({ title: videoIDElement, description: null, h3: getH3(videoIDElement) });
                }
            }
        }


        // Exclude list: Radio and Playlist Normal/Grid/Compact
        // -- Radio/Mix Normal/Grid/Compact: ytd-radio-renderer -- ytd-grid-radio-renderer -- ytd-compact-radio-renderer
        // -- Playlist Normal/Grid/Compact: ytd-playlist-renderer -- ytd-compact-playlist-renderer -- ytd-grid-playlist-renderer
        // Include:
        // -- ytd-video-primary-info-renderer (Main) -- ytd-compact-video-renderer (Side) -- ytd-grid-video-renderer (Home/Channel)
        // -- Playlist Video in Playlist: ytd-playlist-video-renderer
        // -- Playlist Video while watch: ytd-playlist-panel-video-renderer
        // >> Includes -video- only condition

         // MAIN VIDEO DESCRIPTION - request to load original video description
        var mainVidID = "";
        if (needChangeDescription !== false)
        {
            var descriptions = null;
            if (needChangeDescription === undefined)
            {
                descriptions = findDescription();
                needChangeDescription = descriptions.snippet && containsJapanese(descriptions.snippet.innerHTML)
                        || descriptions.expanded && containsJapanese(descriptions.expanded.innerHTML);
            }

            if (needChangeDescription)
            {
                if (videoDescription === undefined)
                {
                    if (!videoDescriptionFailed && window.location.href.includes ("/watch"))
                    {
                        mainVidID = window.location.href.match (/(?:v=)([a-zA-Z0-9-_]{11})/)[1];
                    }
                } else {
                    tryReplaceVideoDescription(descriptions);
                }
            }
        }

        if(mainVidID != "" || videoIDElements.length > 0)
        { // Initiate API request

            if (recheckTimer != -1) {
                clearInterval(recheckTimer);
                recheckTimer = -1;
            }

            // Get all videoIDs to put in the API request
            var IDs = videoIDElements.map( a => getVideoID (a.title));
            var APIFetchIDs = IDs.filter(id => cachedTitles[id] === undefined);
            if (mainVidID != "") APIFetchIDs.splice(0, 0, mainVidID); // Add main video ID
            var totalIDsToDo = APIFetchIDs.length; // Store total amount of IDs for debugging
            APIFetchIDs = APIFetchIDs.slice(0, 50); // Limit total videos to 50
            var requestUrl = url_template.replace("{IDs}", APIFetchIDs.join(','));

            console.log("API Request (" + APIFetchIDs.length + " videos) - " + (totalIDsToDo-APIFetchIDs.length) + " videos remaining!");

            // Issue API request
            var xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function ()
            {
                if (xhr.readyState === 4)
                { // Success
                    var data = JSON.parse(xhr.responseText);

                    if(data.kind == "youtube#videoListResponse")
                    {
                        API_KEY_VALID = true;

                        data = data.items;

                        if (mainVidID != "" && data.length > 0)
                        { // Replace Main Video Description
                            videoDescription = data[0].snippet.description;
                            videoDescriptionFailed = videoDescription === undefined;
                            if (!videoDescriptionFailed)
                            {
                                videoDescription = {
                                    snippet: linkify(videoDescription.slice(0,100)),
                                    expanded: linkify(videoDescription)
                                };
                                tryReplaceVideoDescription(null);
                            } else {
                                console.log ("ERROR: Failed to obtain main video description! Skipping!");
                            }
                            //var pageDescription = document.getElementsByClassName("content style-scope ytd-video-secondary-info-renderer");
                        }

                        // Create dictionary for all IDs and their original titles
                        data.forEach( v => {
                            cachedTitles[v.id] = v.snippet;
                        } );

                        // Change all previously found link elements
                        for(var i = 0; i < videoIDElements.length; ++i){
                            var vidElement = videoIDElements[i];
                            var curID = getVideoID(vidElement.title);
                            if (curID !== IDs[i]) { // Can happen when Youtube was still loading when script was invoked
                                console.log ("WARNING: YouTube replaced content while loading attempt has been made! Retrying in a second!");
                                // Might not have been loaded aswell - fixes rare errors
                                changedSnippetDescription = false;
                                changedExpandedDescription = false;
                                setTimeout(changeTitles, 1000);
                                return;
                            }
                            
                            var cachedTitle = cachedTitles[curID];
                            if (cachedTitle !== undefined)
                            {
                                
                                if (alreadyChanged.indexOf(vidElement.title) == -1)
                                {
                                    var originalTitle = cachedTitle.title;
                                    var pageTitle = vidElement.title.innerText.trim();
                                    if(pageTitle != originalTitle.replace(/\s{2,}/g, ' '))
                                    {
                                        console.log ("-- '" + curID + "': '" + pageTitle + "' --> '" + originalTitle + "'");
                                        vidElement.title.innerText = originalTitle;
                                    }
                                    alreadyChanged.push(vidElement.title);
                                    
                                    if (vidElement.h3 != null)
                                    {
                                        var pageH3 = vidElement.h3.title.trim();
                                        if(pageH3 != originalTitle.replace(/\s{2,}/g, ' '))
                                        {
                                            console.log ("-- '" + curID + "': '" + pageH3 + "' --> '" + originalTitle + "'");
                                            vidElement.h3.title = originalTitle;
                                        }
                                    }
                                }
                                
                                if (vidElement.description != null)
                                {
                                    var originalDescription = cachedTitle.description;
                                    var pageDescription = vidElement.description.innerText.trim();
                                    if(pageDescription != originalDescription.replace(/\s{2,}/g, ' '))
                                    {
                                        console.log ("-- '" + curID + "' (desc): '" + pageDescription + "' --> '" + originalDescription + "'");
                                        vidElement.description.innerText = originalDescription;
                                    }
                                    alreadyChangedDescriptions.push(vidElement.description);
                                }
                            }
                            else if (APIFetchIDs.includes(curID))
                            { // Has been requested, but not been provided info about: Private or deleted video
                                cachedTitles[curID] = {
                                    title: vidElement.title.innerText.trim(),
                                    description: vidElement.description != null ? vidElement.description.innerText.trim() : null
                                };
                                if (alreadyChanged.indexOf(vidElement.title) == -1)
                                {
                                    alreadyChanged.push(vidElement.title);
                                }
                                if (vidElement.description != null)
                                {
                                    alreadyChangedDescriptions.push(vidElement.description);
                                }
                                console.log ("-- '" + curID + "': private or deleted!");
                            }
                        }
                        // Call next iteration
                        setTimeout(changeTitles, 1);
                    }
                    else
                    {
                        console.log("ERROR: API Request Failed!");
                        console.log(requestUrl);
                        console.log(data);

                        // This ensures that occasional fails don't stall the script
                        // But if the first query is a fail then it won't try repeatedly
                        NO_API_KEY = !API_KEY_VALID;
                        if (NO_API_KEY) {
                            GM_setValue('api_key', '');
                            console.log("ERROR: API Key Fail! Please Reload!");
                        }
                    }
                }
            };
            xhr.open('GET', requestUrl);
            xhr.send();
        } else if (recheckTimer == -1) {
            // Finished initial or subsequent page loads and start checking once in a while
            recheckTimer = setInterval(changeTitles, 1000);
        }
    }

    function linkify(inputText) {
        var replacedText, replacePattern1, replacePattern2, replacePattern3, replacePattern4;

        //URLs starting with http://, https://, or ftp://
        replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
        replacedText = inputText.replace(replacePattern1, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="$1">$1</a>');


        //URLs starting with "www." (without // before it, or it'd re-link the ones done above).
        replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
        replacedText = replacedText.replace(replacePattern2, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="http://$1">$1</a>');

        //Change email addresses to mailto:: links.
        replacePattern3 = /(([a-zA-Z0-9\-\_\.])+@[a-zA-Z\_]+?(\.[a-zA-Z]{2,6})+)/gim;
        replacedText = replacedText.replace(replacePattern3, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="mailto:$1">$1</a>');

        if (false)
        {
            //Change timestamps to clickable timestamp links.
            // NOTE: NOT perfect, even with correct html code it will cause the page to reload whereas standard youtube timestamps will not. Probably some behind-the-scenes magic.
            replacePattern4 = /([0-9]+:)?([0-9]+):([0-9]+)/gim;
            replacedText = replacedText.replace(replacePattern4, function(match) {

                // Prepare time by calculating total seconds
                var timeChars = match.split(':'); // Split by hour:minute:seconds
                var time = parseInt(timeChars[0], 10) * 60 + parseInt(timeChars[1], 10); // Only minutes:seconds
                if (timeChars.length >= 3)
                { // Full hours:minutes:seconds
                    time = time * 60 + parseInt(timeChars[2], 10);
                }

                // Prepare URL
                var url = window.location.href; // Get current video URL
                url = url.slice (url.indexOf("/watch?"), url.length); // Make it local
                url = url.replace(/[?&]t=([0-9]+)s/, ""); // Remove existing timestamp
                url = url + "&t=" + time + "s";

                return '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="' + url + '">' + match + '</a>';
            });
        }

        return replacedText;
    }

    // Execute every seconds in case new content has been added to the page
    // DOM listener would be good if it was not for the fact that Youtube changes its DOM frequently
    changeTitles();
})();