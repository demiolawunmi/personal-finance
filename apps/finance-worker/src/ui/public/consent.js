var consentForm = document.getElementById('consent-form');
if (consentForm)
  consentForm.addEventListener('submit', function () {
    var buttons = consentForm.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
  });
