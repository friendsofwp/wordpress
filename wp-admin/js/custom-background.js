var farbtastic;function pickColor(a){farbtastic.setColor(a);jQuery("#background-color").val(a);jQuery("#custom-background-image").css("background-color",a);if(a&&a!=="#"){jQuery("#clearcolor").show()}else{jQuery("#clearcolor").hide()}}jQuery(document).ready(function(){jQuery("#pickcolor").click(function(){jQuery("#colorPickerDiv").show();return false});jQuery("#clearcolor a").click(function(a){pickColor("");a.preventDefault()});jQuery("#background-color").keyup(function(){var b=jQuery("#background-color").val(),a=b;if(a.charAt(0)!="#"){a="#"+a}a=a.replace(/[^#a-fA-F0-9]+/,"");if(a!=b){jQuery("#background-color").val(a)}if(a.length==4||a.length==7){pickColor(a)}});jQuery('input[name="background-position-x"]').change(function(){jQuery("#custom-background-image").css("background-position",jQuery(this).val()+" top")});jQuery('input[name="background-repeat"]').change(function(){jQuery("#custom-background-image").css("background-repeat",jQuery(this).val())});farbtastic=jQuery.farbtastic("#colorPickerDiv",function(a){pickColor(a)});pickColor(jQuery("#background-color").val());jQuery(document).mousedown(function(){jQuery("#colorPickerDiv").each(function(){var a=jQuery(this).css("display");if(a=="block"){jQuery(this).fadeOut(2)}})})});