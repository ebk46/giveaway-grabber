const Tesseract = require('tesseract.js');
const { sendSystemNotification } = require('./utils');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function getInput(prompt) {
    return new Promise(function(resolve, reject) {
      rl.question(prompt, (answer) => {
        resolve(answer);
      });
    })
}

function readInput(buffer) {
    return new Promise(function(resolve, reject) {
        let code = '';
        buffer.on('data', (chunk) => {
            code += `${chunk}\n`
        })
        buffer.on('end', () => {
            console.log("\nReceived END signal")
            const empty_inputs = ['', ' ', '\n', '\n\n']
            if (empty_inputs.includes(code)) {
                log('[!] No input was passed in!')
                reject()
            } else {
                resolve(code)
            }
        })
        buffer.setEncoding('utf8')
        buffer.resume()
    })
}

function promiseTimeout(ms, promise){

  return new Promise(function(resolve, reject){

    // create a timeout to reject promise if not resolved
    var timer = setTimeout(function(){
        reject(new Error("promise timeout"));
    }, ms);

    promise
        .then(function(res){
            clearTimeout(timer);
            resolve(res);
        })
        .catch(function(err){
            clearTimeout(timer);
            reject(err);
        });
  });
};

/**
 * Goes to Amazon Sign In page and tries to sign in with given credentials
 * @param {Puppeteer.Page} page
 * @param {string} username
 * @param {string} password
 * @param {number} pageNumber
 * @param {boolean} twoFactorAuth
 * @param {boolean} rememberMe
 * @returns {Promise<void>}
 */
module.exports = async function(
	page,
	username,
	password,
	pageNumber,
	twoFactorAuth,
	rememberMe
) {
	const returnUrl = encodeURIComponent(
		'https://www.amazon.com/ga/giveaways?pageId=' + pageNumber
	);
	await page.goto(
		'https://www.amazon.com/ap/signin?_encoding=UTF8&ignoreAuthState=1&openid.assoc_handle=usflex&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.mode=checkid_setup&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&openid.ns.pape=http%3A%2F%2Fspecs.openid.net%2Fextensions%2Fpape%2F1.0&openid.pape.max_auth_age=0&openid.return_to=' +
			returnUrl +
			'&switch_account='
	);

	try {
		await page.waitForSelector('#ap_email', {
			timeout: 1000
		});
		await page.click('#ap_email');
		await page.type('#ap_email', username);
	} catch (error) {
		console.log('No email field');
	}

	await page.waitForSelector('#ap_password');
	await page.click('#ap_password');
	await page.type('#ap_password', password);

	if (rememberMe) {
		try {
			await page.waitForSelector('[name=rememberMe]', {
				timeout: 1000
			});
			await page.click('[name=rememberMe]');
		} catch (error) {
			// couldn't click rememberMe, no big deal
		}
	}

	const signInPromise = page.waitForNavigation();
	await page.waitForSelector('#signInSubmit');
	await page.click('#signInSubmit');
	await signInPromise;

	await checkForCaptcha(page, password);
	await page.screenshot({
       path: 'post-captcha.png'
  });
  try {
    await page.waitForSelector('#continue', {
      timeout: 1000
    });
    console.log("Found OTP, Clicking 'Continue'.")
    await page.click('#continue');
    await page.waitForSelector('.cvf-widget-input', {
      timeout: 3000
    });
    await page.click('.cvf-widget-input');
    let otp = await getInput("Enter OTP: ");
		otp = otp.trim().replace(' ', '');
		console.log("You entered: '", otp, "'");
		console.log("Your OTP is ", otp.length, " chars long");
    await page.type(
			'.cvf-widget-input',
			otp
		);
    console.log("Typed in OTP");
    await page.screenshot({
      path: 'otp-typed.png'
    });
    await page.waitForSelector('.cvf-widget-btn-verify .a-button-inner .a-button-input', {
      timeout: 1000
    });
    console.log("Found submit button. Clicking.")
    await page.click('.cvf-widget-btn-verify .a-button-inner .a-button-input');
    const otpSubmittedPromise = page.waitForNavigation({ timeout: 0 });
    await otpSubmittedPromise;
    console.log("Wow we made it.")
  } catch (error) {
    console.log("Error: ", error);
    //const html = await page.content();
    //console.log(html);
  }

	if (twoFactorAuth) {
		try {
			await page.waitForSelector('#auth-mfa-otpcode', {
				timeout: 1000
			});
			if (rememberMe) {
				await page.waitForSelector('#auth-mfa-remember-device', {
					timeout: 1000
				});
				await page.click('#auth-mfa-remember-device');
			}
			console.log('Waiting for two factor authentication...');
			const twoFactorAuthPromise = page.waitForNavigation({ timeout: 0 });
			await twoFactorAuthPromise;
		} catch (error) {
			//couldn't click remember device, no big deal
		}
	}
};

/**
 * Check if there's a captcha, tries to guess it.
 * Then re-enters password and waits for user to verify captcha guess
 * and click the sign in button themselves.
 * @param {Puppeteer.Page} page
 * @param {string} password
 * @returns {Promise<void>}
 */
async function checkForCaptcha(page, password) {
	console.log('checkForCaptcha');
	try {
		await page.waitForSelector('#auth-captcha-image', { timeout: 500 });
		const url = await page.$eval(
			'img[src*="opfcaptcha-prod"]',
			el => el.src
		);

		const tessValue = await Tesseract.recognize(url).then(function(result) {
			return result;
		});
		console.log('OCR Value:  ' + tessValue.text.trim().replace(' ', ''));
		await page.waitForSelector('#auth-captcha-guess');
		await page.click('#auth-captcha-guess');
		await page.screenshot({
      path: 'captcha.png'
    });
		let code = await getInput("Enter CAPTCHA: ");
		code = code.trim().replace(' ', '');
		console.log("You entered: '", code, "'")
		console.log("Your code is ", code.length, " chars long")
		await page.type(
			'#auth-captcha-guess',
			code
			//tessValue.text.trim().replace(' ', '')
		);
		console.log("Submitted CAPTCHA")

		//enter password again...
		await page.waitForSelector('#ap_password');
		await page.click('#ap_password');
		await page.type('#ap_password', password);

		const message = 'ENTER CAPTCHA!';
		console.log(message);

		const notification = {
			title: 'giveaway-grabber',
			message: message
		};
		sendSystemNotification(notification);
		// Since we are trying to remotely enter the CAPTCHA, we need
		// to click the button now
		await page.screenshot({
      path: 'pre-captcha-submit.png'
    });
  	await page.waitForSelector('#signInSubmit');
  	await page.click('#signInSubmit');

		await page.waitFor(
			() => !document.querySelector('#auth-captcha-image'),
			{
				timeout: 0
			}
		);
	} catch (error) {
		//nothing to do here...
		//console.log(error);
	}
}
