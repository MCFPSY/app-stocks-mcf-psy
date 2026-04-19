// Side-effect module: importa jQuery e define-o como global
// antes de jquery-ui/pivottable (que esperam window.jQuery).
import jQuery from 'jquery';
window.$ = window.jQuery = jQuery;
export default jQuery;
