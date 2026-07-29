const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");

// POST /api/translate/urdu
// Body: { text: "English or Roman Urdu text" }
// Returns: { urdu: "اردو متن" }
router.post("/urdu", protect, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, message: "Text is required" });
  }

  try {
    // MyMemory free API - no key needed, handles proper nouns well
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.trim())}&langpair=en|ur`;
    const response = await fetch(url);
    const data = await response.json();

    const urdu = data?.responseData?.translatedText?.trim();

    if (!urdu || urdu === text.trim()) {
      return res.status(500).json({ success: false, message: "Translation failed" });
    }

    res.json({ success: true, urdu });
  } catch (err) {
    console.error("Translate error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;