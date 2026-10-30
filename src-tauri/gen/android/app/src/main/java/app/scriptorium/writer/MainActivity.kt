package app.scriptorium.writer

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Draw the app between the status bar and the gesture bar (and clear of any camera cut-out).
    // The web page's own env(safe-area-inset-*) is not reliable inside a WebView, so do it here.
    val root: View = findViewById(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
